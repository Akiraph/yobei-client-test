import { render } from 'solid-js/web';
import App from './app/App';
import './assets/fonts/fonts.css';
import './styles/theme.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/utilities.css';

render(() => <App />, document.getElementById('root') as HTMLElement);
