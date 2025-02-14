import { ErrorBoundary } from 'react-error-boundary';
import * as LocalStorage from './components/LocalStorage';
import ASTOutputContainer from './containers/ASTOutputContainer';
import CodeEditorContainer from './containers/CodeEditorContainer';
import ErrorMessageContainer from './containers/ErrorMessageContainer';
import GistBanner from './components/GistBanner';
import LoadingIndicatorContainer from './containers/LoadingIndicatorContainer';
import PasteDropTargetContainer from './containers/PasteDropTargetContainer';
import PropTypes from 'prop-types';
import {publish, subscribe} from './utils/pubsub.js';
import * as React from 'react';
import SettingsDialogContainer from './containers/SettingsDialogContainer';
import ShareDialogContainer from './containers/ShareDialogContainer';
import SplitPane from './components/SplitPane';
import ToolbarContainer from './containers/ToolbarContainer';
import TransformerContainer from './containers/TransformerContainer';
import debounce from './utils/debounce';
import {Provider, connect} from 'react-redux';
import {astexplorer, persist, revive} from './store/reducers';
import {createStore, applyMiddleware, compose} from 'redux';
import {canSaveTransform, getRevision} from './store/selectors';
import {loadSnippet, setCode, setFilePath, setId} from './store/actions';
import {render} from 'react-dom';
import * as gist from './storage/gist';
import * as parse from './storage/parse';
import StorageHandler from './storage';
import '../css/style.css';
import parserMiddleware from './store/parserMiddleware';
import snippetMiddleware from './store/snippetMiddleware.js';
import transformerMiddleware from './store/transformerMiddleware';
import cx from './utils/classnames.js';
import { getVSCode, replaceUrl } from './utils/vscode.js';

import {
  webviewReactDidmount,
  REDUX_MESSAGE,
  SEND_EXT,
  selectCategory,
  setParser,
  highlight,
  SEND_FILEPATH,
  clearHighlight,
  SEND_ID,
  setFilepath,
} from '@shared/actions'
import { extToCategoryIdMap, extToParserIdMap } from '@shared/map';
import { getCategoryByID, getParserByID } from './parsers';

function resize() {
  publish('PANEL_RESIZE');
}

const vscode = getVSCode();
if (vscode) {
  // hack webpack's dynamic import script injection
  const originalAppendChild = document.head.appendChild;
  document.head.appendChild = (element) => {
    if (element.tagName === 'SCRIPT' && element.src) {
      const originalUrl = element.getAttribute('src');
      replaceUrl(originalUrl).then((newUrl) => {
        element.setAttribute('src', newUrl);
        originalAppendChild.call(document.head, element);
      });
    }
  };

  // hack wasm fetch
  const originalFetch = global.fetch;
  global.fetch = (url, options) => {
    if (url.startsWith("http")) {
      return originalFetch(newUrl, options);
    }

    return replaceUrl(url).then((newUrl) => {
      return originalFetch(newUrl, options);
    });
  };
}

function App({showTransformer, hasError}) {
  // vscode sends message to webview
  React.useEffect(() => {
    const messageHandler = (e) => {
      if (!e.origin.startsWith('vscode-webview')) {
        return;
      }
      console.log('[message from vscode]', e.data);

      if (e.data.type === SEND_ID) {
        const { id } = e.data;
        store.dispatch(setId(id));

        return;
      }

      const { id } = store.getState();

      if (e.data.id !== id) {
        return;
      }

      switch (e.data.type) {
        // get ext
        case SEND_EXT:
          const { ext } = e.data;

          // get category id by ext
          const categoryId = extToCategoryIdMap[ext] || 'javascript';

          // get category by category id 
          const category = getCategoryByID(categoryId);

          // update category
          store.dispatch(selectCategory(category));

          if (extToParserIdMap[ext]) {
            // get parser id by ext
            const parserId = extToParserIdMap[ext];

            // get parser by parser id
            const parser = getParserByID(parserId);

            // change parser
            store.dispatch(setParser(parser));
          }
          return;

        // get relative path
        case SEND_FILEPATH:
          const { filepath } = e.data;

          if (filepath) {
            store.dispatch(setFilepath(filepath));
          }

          return;

        // get redux action
        case REDUX_MESSAGE:
          store.dispatch(e.data.reduxAction);
          return;
      }
    };

    window.addEventListener('message', messageHandler);

    if (vscode) {
      vscode.postMessage(webviewReactDidmount());
    }

    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, []);

  // forward events fired by ASToutput to vscode
  React.useEffect(() => {
    if (!vscode) {
      return;
    }

    subscribe('HIGHLIGHT', ({ range }) => {
      if (!range) {
        return;
      }

      const state = store.getState();
      const { id } = state;
      vscode.postMessage(highlight(id, range));
    });

    subscribe('CLEAR_HIGHLIGHT', () => {
      const { id } = store.getState();

      vscode.postMessage(clearHighlight(id));
    });
  }, []);

  return (
    <ErrorBoundary fallback={<div style={{display: 'flex', flexDirection: 'column' ,alignItems: 'center', justifyContent:'center'}}>
      <h1>Something went wrong.</h1>
      <div>
        please &nbsp;
        <button onClick={()=>{
          LocalStorage.clearState();
        }}>Clear Local Storage</button>
        &nbsp;and reopen the page.
      </div>
    </div>}>
      <ErrorMessageContainer />
      <PasteDropTargetContainer id="main" className={cx({hasError})}>
        <LoadingIndicatorContainer />
        <SettingsDialogContainer />
        <ShareDialogContainer />
        <ToolbarContainer />
        <GistBanner />
        <SplitPane
          className="splitpane-content"
          vertical={true}
          onResize={resize}>
          <SplitPane
            className="splitpane"
            onResize={resize}>
            {vscode ? null : <CodeEditorContainer />} 
            <ASTOutputContainer />
          </SplitPane>
          {showTransformer ? <TransformerContainer /> : null}
        </SplitPane>
      </PasteDropTargetContainer>
    </ErrorBoundary>
  );
}

App.propTypes = {
  hasError: PropTypes.bool,
  showTransformer: PropTypes.bool,
};

const AppContainer = connect(
  state => ({
    showTransformer: state.showTransformPanel,
    hasError: !!state.error,
  }),
)(App);

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
const storageAdapter = new StorageHandler([gist, parse]);
const store = createStore(
  astexplorer,
  revive(LocalStorage.readState()),
  composeEnhancers(
    applyMiddleware(snippetMiddleware(storageAdapter), parserMiddleware, transformerMiddleware),
  ),
);
store.subscribe(debounce(() => {
  const state = store.getState();
  // We are not persisting the state while looking at an existing revision
  if (!getRevision(state)) {
    LocalStorage.writeState(persist(state));
  }
}));
store.dispatch({type: 'INIT'});

render(
  <Provider store={store}>
    <AppContainer />
  </Provider>,
  document.getElementById('container'),
);

global.onhashchange = () => {
  store.dispatch(loadSnippet());
};

if (location.hash.length > 1) {
  store.dispatch(loadSnippet());
}

global.onbeforeunload = () => {
  const state = store.getState();
  if (canSaveTransform(state)) {
    return 'You have unsaved transform code. Do you really want to leave?';
  }
};
