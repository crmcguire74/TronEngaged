import '@fontsource/syncopate/400.css';
import '@fontsource/syncopate/700.css';
import '@fontsource/saira-condensed/400.css';
import '@fontsource/saira-condensed/500.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/share-tech-mono/400.css';
import './ui/styles.css';
import { App } from './app/app';

const app = new App(document.getElementById('stage') as HTMLCanvasElement, document.getElementById('ui') as HTMLElement);
void app.boot();
// Test hooks: deterministic state access for automated QA; never used by gameplay.
(window as any).__GAME__ = app;
