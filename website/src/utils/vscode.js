import { REPLACE_URL, URL_REPLACED } from "@shared/actions";

let vscode = null;

export function getVSCode() {
  if (typeof acquireVsCodeApi === 'function') {
    if (vscode === null) {
      vscode = acquireVsCodeApi();
    }
  }
  return vscode;
}

export function replaceUrl(originalUrl) {
  const vscode = getVSCode();

  if (vscode) {
    return new Promise((resolve) => {
      vscode.postMessage({
        type: REPLACE_URL,
        originalUrl,
      });

      const handler = (e) => {
        if (
          e.data.type === URL_REPLACED &&
          e.data.originalUrl === originalUrl
        ) {
          resolve(e.data.newUrl);
          window.removeEventListener('message', handler);
        }
      };

      window.addEventListener('message', handler);
    });
  }
}
