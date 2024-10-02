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
        type: 'replace-url',
        originalUrl,
      });

      const handler = (e) => {
        if (
          e.data.type === 'url-replaced' &&
          e.data.originalUrl === originalUrl
        ) {
          // console.log('replaced', e.data);
          resolve(e.data.newUrl);
          window.removeEventListener('message', handler);
        }
      };

      window.addEventListener('message', handler);
    });
  }
}
