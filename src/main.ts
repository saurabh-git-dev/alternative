import { mount } from 'svelte';
import './ui/theme.css';
import App from './ui/App.svelte';
import { loadTheme } from './ui/settings';

document.documentElement.dataset.theme = loadTheme();

mount(App, { target: document.getElementById('app')! });
