import {
  loadMacroDesk,
  type LoadMacroDeskOptions,
  type MacroDeskView,
} from "./load-macro-desk";
import {
  LIVE_DATA_UNAVAILABLE_MESSAGE,
  PUBLIC_DEMO_FIXTURE_PATH,
  PUBLIC_DEMO_SOURCE_LABEL,
  isPublicDemoMode,
} from "./public-demo";

export type DeskSourceQuery = "live" | "fixture" | undefined;

export interface ResolveDeskRequestOptions {
  readonly source?: DeskSourceQuery | string | null;
  readonly publicDemo?: boolean;
  readonly dataRoot?: string;
  readonly fixturePath?: string;
}

function liveUnavailableView(publicDemo: boolean): MacroDeskView {
  return {
    status: "live_unavailable",
    source: null,
    sourceLabel: null,
    isDemo: false,
    isLiveDriver: false,
    isPublicDemo: publicDemo,
    driver: null,
    driverPath: null,
    snapshotPresent: false,
    snapshotPath: null,
    sessionStale: false,
    pipeline: null,
    error: {
      code: "live_unavailable",
      message: LIVE_DATA_UNAVAILABLE_MESSAGE,
    },
  };
}

function markPublicDemo(view: MacroDeskView): MacroDeskView {
  if (!view.driver) {
    return { ...view, isPublicDemo: true, isLiveDriver: false };
  }
  return {
    ...view,
    isPublicDemo: true,
    isDemo: true,
    isLiveDriver: false,
    source: "fixture",
    sourceLabel: PUBLIC_DEMO_SOURCE_LABEL,
    // Public demo is historical by definition — do not surface local stale/pipeline.
    sessionStale: false,
    pipeline: null,
    error: null,
    status: "ready",
  };
}

/**
 * Resolve page/API query into a desk view.
 *
 * Local (publicDemo=false): unchanged M1-10 behaviour.
 * Public demo: frozen fixture only; `?source=live` → live_unavailable (no silent fixture).
 */
export function resolveDeskRequest(
  options: ResolveDeskRequestOptions = {},
): MacroDeskView {
  const publicDemo = options.publicDemo ?? isPublicDemoMode();
  const source =
    options.source === "live" || options.source === "fixture"
      ? options.source
      : undefined;

  if (publicDemo) {
    if (source === "live") {
      return liveUnavailableView(true);
    }
    const view = loadMacroDesk({
      dataRoot: options.dataRoot ?? "data",
      fixturePath: options.fixturePath ?? PUBLIC_DEMO_FIXTURE_PATH,
      preferFixture: true,
      allowFixture: true,
      // Never consult live drivers in public demo mode.
      publicDemoMode: true,
    });
    return markPublicDemo(view);
  }

  const loadOptions: LoadMacroDeskOptions = {
    dataRoot: options.dataRoot,
    fixturePath: options.fixturePath,
    preferFixture: source === "fixture",
    allowFixture: source !== "live",
  };
  const view = loadMacroDesk(loadOptions);
  return { ...view, isPublicDemo: false };
}
