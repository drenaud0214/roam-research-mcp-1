import { q } from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SearchUtils } from '../../search/utils.js';
import { executeBatch } from '../helpers/batch-utils.js';

const MS_PER_DAY = 86_400_000;

const DATE_PAGE_REF_RE = /\[\[(?:January|February|March|April|May|June|July|August|September|October|November|December)\s/i;
const DATE_TAG_RE = /#(?:due|scheduled|deadline)/i;
const PARKED_RE = /#(?:\[\[parked\]\]|parked|\[\[someday\]\]|someday)/i;
const AT_RISK_RE = /#(?:\[\[at-risk\]\]|at-risk)/g;
const STALE_RE = /#(?:\[\[stale\]\]|stale)/;

export interface TriageTasksParams {
  at_risk_days?: number;
  stale_days?: number;
  page_title_uid?: string;
  dry_run?: boolean;
}

export interface TriagedTask {
  uid: string;
  content: string;
  page_title: string;
  age_days: number;
  action: string;
}

export interface TriageTasksResult {
  success: boolean;
  dry_run: boolean;
  thresholds: { at_risk_days: number; stale_days: number };
  summary: {
    fresh: number;
    at_risk: number;
    stale: number;
    parked: number;
    skipped_dated: number;
    tags_applied: number;
  };
  at_risk: TriagedTask[];
  stale: TriagedTask[];
}

export class TaskAgingOperations {
  constructor(private graph: Graph) {}

  async triageTasks(params: TriageTasksParams): Promise<TriageTasksResult> {
    const atRiskDays = params.at_risk_days ?? 14;
    const staleDays = params.stale_days ?? 30;
    const dryRun = params.dry_run ?? false;
    const now = Date.now();

    let targetPageUid: string | undefined;
    if (params.page_title_uid) {
      targetPageUid = await SearchUtils.findPageByTitleOrUid(this.graph, params.page_title_uid);
    }

    const queryStr = targetPageUid
      ? `[:find ?uid ?str ?page-title ?create-time
          :in $ ?page-uid
          :where [?p :block/uid ?page-uid]
                 [?b :block/page ?p]
                 [?p :node/title ?page-title]
                 [?b :block/uid ?uid]
                 [?b :block/string ?str]
                 [(clojure.string/includes? ?str "{{TODO")]
                 [(get-else $ ?b :create/time 0) ?create-time]]`
      : `[:find ?uid ?str ?page-title ?create-time
          :where [?b :block/string ?str]
                 [?b :block/uid ?uid]
                 [?b :block/page ?p]
                 [?p :node/title ?page-title]
                 [(clojure.string/includes? ?str "{{TODO")]
                 [(get-else $ ?b :create/time 0) ?create-time]]`;

    const inputs = targetPageUid ? [targetPageUid] : [];
    const rawResults = await q(this.graph, queryStr, inputs) as [string, string, string, number][];

    const batchUpdates: { action: string; block: { uid: string; string: string } }[] = [];
    const atRiskItems: TriagedTask[] = [];
    const staleItems: TriagedTask[] = [];
    let freshCount = 0;
    let parkedCount = 0;
    let datedCount = 0;

    for (const [uid, str, pageTitle, createTime] of rawResults) {
      if (DATE_PAGE_REF_RE.test(str) || DATE_TAG_RE.test(str)) {
        datedCount++;
        continue;
      }
      if (PARKED_RE.test(str)) {
        parkedCount++;
        continue;
      }

      const ageDays = createTime > 0 ? (now - createTime) / MS_PER_DAY : 0;
      const alreadyAtRisk = AT_RISK_RE.test(str);
      const alreadyStale = STALE_RE.test(str);

      // Reset regex lastIndex since AT_RISK_RE has the global flag
      AT_RISK_RE.lastIndex = 0;

      if (ageDays >= staleDays) {
        if (!alreadyStale) {
          const newStr = str.replace(AT_RISK_RE, '').trimEnd() + ' #stale';
          staleItems.push({ uid, content: str, page_title: pageTitle, age_days: Math.floor(ageDays), action: 'tagged #stale' });
          if (!dryRun) {
            batchUpdates.push({ action: 'update-block', block: { uid, string: newStr } });
          }
        } else {
          staleItems.push({ uid, content: str, page_title: pageTitle, age_days: Math.floor(ageDays), action: 'already #stale' });
        }
      } else if (ageDays >= atRiskDays) {
        if (!alreadyAtRisk && !alreadyStale) {
          const newStr = str.trimEnd() + ' #at-risk';
          atRiskItems.push({ uid, content: str, page_title: pageTitle, age_days: Math.floor(ageDays), action: 'tagged #at-risk' });
          if (!dryRun) {
            batchUpdates.push({ action: 'update-block', block: { uid, string: newStr } });
          }
        } else {
          atRiskItems.push({
            uid,
            content: str,
            page_title: pageTitle,
            age_days: Math.floor(ageDays),
            action: alreadyAtRisk ? 'already #at-risk' : 'already #stale',
          });
        }
      } else {
        freshCount++;
      }
    }

    if (!dryRun && batchUpdates.length > 0) {
      await executeBatch(this.graph, batchUpdates, 'apply task aging tags');
    }

    return {
      success: true,
      dry_run: dryRun,
      thresholds: { at_risk_days: atRiskDays, stale_days: staleDays },
      summary: {
        fresh: freshCount,
        at_risk: atRiskItems.length,
        stale: staleItems.length,
        parked: parkedCount,
        skipped_dated: datedCount,
        tags_applied: dryRun ? 0 : batchUpdates.length,
      },
      at_risk: atRiskItems,
      stale: staleItems,
    };
  }
}
