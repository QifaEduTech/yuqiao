import React from 'react';
import {createRoot} from 'react-dom/client';
import LearningPage from './LearningPage';
import './styles.css';
import './learning.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LearningPage/></React.StrictMode>);
