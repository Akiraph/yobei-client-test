/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';
import { resourcesReady } from './lib/i18n';

import './styles/fog.css';
import './styles/base.css';
import './styles/components.css';
import './styles/widgets.css';
import './styles/layout.css';

void resourcesReady.finally(() => {
  render(() => <App />, document.getElementById('root') as HTMLElement);
});
