/**
 * The webview is presentation only. A nonce plus a strict CSP keeps injected
 * markup from running: no inline script, no remote origins, no eval.
 *
 * Kept free of the `vscode` module so the markup can be asserted in tests.
 */
export function renderWebviewHtml(options: { cspSource: string; nonce: string; asset: (file: string) => string }): string {
  const { cspSource, nonce, asset } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('main.css')}">
<title>Moderado</title>
</head>
<body>
<script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}