import { request } from "./http";
import type { DraftHereResult } from "@/features/drafthere/shape";
import type { Placement } from "@/features/drafthere/target";

/**
 * "Draft here": ask the lawyer's own AI for one clause at the cursor. Runs only
 * in ArkLaw's community build (src/community/localRouter.ts handles this path);
 * there is no hosted endpoint for it.
 */
export const DRAFT_HERE_PATH = "/api/v1/drafting/clause/draft-here";

export interface DraftHereRequest {
  documentText: string;
  heading: string;
  note: string;
  instructions: string;
  placement: Placement;
  /** The lawyer's default jurisdiction code from Settings ("" = Australia). */
  jurisdiction: string;
  /** The rejected version, on "Try again". */
  previousAttempt?: string;
}

export async function requestDraftHere(body: DraftHereRequest): Promise<DraftHereResult> {
  return request<DraftHereResult>(DRAFT_HERE_PATH, { method: "POST", body });
}
