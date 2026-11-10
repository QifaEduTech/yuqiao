import React from 'react';
import {createRoot} from 'react-dom/client';
import RealtimePage from './RealtimePage';
import './styles.css';
import './realtime.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><RealtimePage/></React.StrictMode>);
