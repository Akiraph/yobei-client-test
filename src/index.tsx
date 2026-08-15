/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';

import './styles/fog.css';
import './styles/base.css';
import './styles/components.css';
import './styles/widgets.css';
import './styles/layout.css';

// The bundled locale is enough to paint the shell. Remote or platform locale
// discovery must not leave a mobile WebView blank while it waits for IPC.
render(() => <App />, document.getElementById('root') as HTMLElement);
