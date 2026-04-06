import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './pwa/register-sw';
import './styles.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('Root element #app not found');
}

registerServiceWorker();

ReactDOM.createRoot(root).render(<App />);
