import React from 'react';
import ReactDOM from 'react-dom/client';
import { PoolApp } from './PoolApp';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PoolApp />
  </React.StrictMode>,
);
