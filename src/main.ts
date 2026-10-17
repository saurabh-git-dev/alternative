import { mount } from 'svelte';
import './ui/theme.css';
import App from './ui/App.svelte';
import { loadTheme } from './ui/settings';
import { setupInstall } from './pwa/install.svelte';

document.documentElement.dataset.theme = loadTheme();
setupInstall();

mount(App, { target: document.getElementById('app')! });
