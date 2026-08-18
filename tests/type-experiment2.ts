/**
 * 类型实验 2（临时）：复现 WanyanAI envSchema 结构（4 facets + extend）
 */
import { z } from "zod";
import {
  adminFacet,
  authCenterFacet,
  composeFacets,
  deploymentFacet,
  userCenterFacet,
} from "../src/config";

const envSchema = composeFacets(
  deploymentFacet,
  authCenterFacet,
  userCenterFacet,
  adminFacet
).extend({
  LOG_LEVEL: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

type Out = z.output<typeof envSchema>;
declare const out: Out;
// 期望：AUTH_CENTER_URL 与 LOG_LEVEL 均为 string | undefined
const p1: string | undefined = out.AUTH_CENTER_URL;
const p2: string | undefined = out.LOG_LEVEL;

export { p1, p2 };
