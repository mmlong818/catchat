import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Note: StrictMode disabled — its double-invocation of effects interferes with
// WebSocket/WebRTC resource lifecycles. Effects still have proper cleanup.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
