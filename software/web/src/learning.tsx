import React from 'react';
import {createRoot} from 'react-dom/client';
import LearningPage from './LearningPage';
import {AuthGate} from './AuthGate';
import './styles.css';
import './learning.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="normal"><LearningPage/></AuthGate></React.StrictMode>);
