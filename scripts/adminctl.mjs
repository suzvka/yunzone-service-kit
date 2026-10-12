#!/usr/bin/env node
/**
 * adminctl — 管理后台密码本运维工具（v2.0 Admin Keybook Protocol）
 *
 * 子命令：
 *   genkey  --id <条目名> [--out <目录>]        生成 Ed25519 密钥对：私钥 PEM 落盘 + 打印密码本条目
 *   keybook --in <文件|url>                     解析并打印指纹与条目表（重启前核对）
 *   demo    [--out <目录>] [--id <前缀>]        生成本地开发用密码本 + 配套私钥（仅限开发！）
 *
 * 依赖构建产物 dist/ops（指纹/解析唯一实现，防脚本与库漂移）：
 * 未构建时先 `pnpm build`。
 */

import { generateKeyPairSync } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** 解析 --kv 风格参数 */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** 动态加载 kit 构建产物（未构建给出指引） */
async function loadKitOps() {
  const distEntry = resolve(SCRIPT_DIR, "../dist/ops/index.js");
  try {
    return await import(pathToFileURL(distEntry).href);
  } catch {
    console.error(
      `[adminctl] 无法加载 ${distEntry}：请先在 kit 目录执行 pnpm build`
    );
    process.exit(1);
  }
}

/** 生成一版密钥对：返回 { 私钥PEM, 密码本条目 } */
function generateEntry(id) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicB64url = publicKey.export({ format: "jwk" }).x;
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    entry: {
      id,
      public_key: publicB64url,
      label: "",
      added_at: new Date().toISOString().slice(0, 10),
      revoked_at: null,
    },
  };
}

async function cmdGenkey(args) {
  if (!args.id) {
    console.error("[adminctl] genkey 需要 --id <条目名>（[A-Za-z0-9][A-Za-z0-9_:-]{0,63}）");
    process.exit(1);
  }
  const outDir = resolve(args.out ?? ".");
  await mkdir(outDir, { recursive: true });
  const { privatePem, entry } = generateEntry(args.id);
  const keyPath = resolve(outDir, `${args.id}.private.pem`);
  await writeFile(keyPath, privatePem, "utf8");

  console.log(`✅ 私钥已写入：${keyPath}`);
  console.log("   ⚠️ 私钥是登录的唯一凭证：离线保存到受控机器，绝不上传、绝不进仓库。");
  console.log("\n密码本条目（粘贴进 keybook.json 的 keys 数组）：\n");
  console.log(JSON.stringify(entry, null, 2));
}

async function readSource(ops, source) {
  if (/^https?:\/\//i.test(source)) {
    // 复用库实现（超时/脱敏语义一致）；loadAdminKeybook 返回 LoadedAdminKeybook
    return ops.loadAdminKeybook(source);
  }
  return ops.loadAdminKeybook(resolve(source));
}

async function cmdKeybook(args) {
  if (!args.in) {
    console.error("[adminctl] keybook 需要 --in <文件路径|http(s) URL>");
    process.exit(1);
  }
  const ops = await loadKitOps();
  let keybook;
  try {
    keybook = await readSource(ops, args.in);
  } catch (err) {
    console.error(`[adminctl] 密码本加载失败：${err.message}`);
    process.exit(1);
  }
  console.log(`指纹：${keybook.fingerprint}`);
  console.log(`条目：${keybook.keys.length}`);
  for (const k of keybook.keys) {
    const state = ops.isAdminKeyRevoked(k) ? `已撤销(${k.revokedAt})` : "有效";
    console.log(`  - ${k.id.padEnd(24)} ${state}  added=${k.addedAt ?? "-"} label=${k.label ?? "-"}`);
  }
}

async function cmdDemo(args) {
  const outDir = resolve(args.out ?? ".");
  await mkdir(outDir, { recursive: true });
  const prefix = args.id ?? "demo";
  const names = [`${prefix}-a`, `${prefix}-b`];
  const entries = [];
  for (const name of names) {
    const { privatePem, entry } = generateEntry(name);
    entry.label = "本地开发 demo（仅限开发！）";
    await writeFile(resolve(outDir, `${name}.private.pem`), privatePem, "utf8");
    entries.push(entry);
  }
  const keybookPath = resolve(outDir, "keybook.json");
  await writeFile(
    keybookPath,
    JSON.stringify({ version: 1, keys: entries }, null, 2),
    "utf8"
  );
  const ops = await loadKitOps().catch(() => null);
  console.log(`✅ 开发密码本：${keybookPath}`);
  console.log(`   配套私钥：${names.map((n) => `${n}.private.pem`).join("、")}（同目录）`);
  if (ops) {
    const { parseAdminKeybook } = ops;
    const { readFile } = await import("node:fs/promises");
    const loaded = parseAdminKeybook(await readFile(keybookPath, "utf8"));
    console.log(`   指纹：${loaded.fingerprint}`);
  }
  console.log("   ⚠️ demo 密钥严禁用于任何非本地开发环境。");
}

const HELP = `adminctl — 管理后台密码本运维工具（v2.0）

用法：
  node scripts/adminctl.mjs genkey  --id <条目名> [--out <目录>]
  node scripts/adminctl.mjs keybook --in <文件|url>
  node scripts/adminctl.mjs demo    [--out <目录>] [--id <前缀>]

协议与密码本形态：docs/admin-keybook-protocol.md`;

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
switch (command) {
  case "genkey":
    await cmdGenkey(args);
    break;
  case "keybook":
    await cmdKeybook(args);
    break;
  case "demo":
    await cmdDemo(args);
    break;
  default:
    console.log(HELP);
    process.exit(command ? 1 : 0);
}
