// Vite's `?raw` suffix: any file imported as a raw string module.
// The playground bundles the Pine strategy this way and the engine test mirrors it.
declare module "*.script?raw" {
  const source: string;
  export default source;
}

// The dashboard HTML is imported as raw text by the help-dialog test to assert
// the feature/data-source explainer stays present.
declare module "*.html?raw" {
  const source: string;
  export default source;
}

// The dashboard TS source is imported as raw text by the cell-deselect test to
// guard the no-initial-selection / click-background-to-deselect behavior.
declare module "*.ts?raw" {
  const source: string;
  export default source;
}