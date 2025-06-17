// src/components/TimerDisplay.js
import React, { useState, useEffect } from 'react';
import { useTaskContext } from '../contexts/TaskContext';
import { format } from 'date-fns';

const TimerDisplay = () => {
  const { 
    timer, 
    timeFormatted, 
    lastScreenshotTime,
    keyboardCount,
    mouseCount
  } = useTaskContext();
  
  const [lastScreenshotAgo, setLastScreenshotAgo] = useState('never');

  useEffect(() => {
    const updateScreenshotTime = () => {
      if (!lastScreenshotTime) {
        setLastScreenshotAgo('never');
        return;
      }
      const now = new Date();
      const diffInSeconds = Math.floor((now - new Date(lastScreenshotTime)) / 1000);
      
      if (diffInSeconds < 60) {
        setLastScreenshotAgo(`${diffInSeconds} seconds ago`);
      } else {
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        setLastScreenshotAgo(`${diffInMinutes} ${diffInMinutes === 1 ? 'minute' : 'minutes'} ago`);
      }
    };

    updateScreenshotTime();
    const intervalId = setInterval(updateScreenshotTime, 60000);
    return () => clearInterval(intervalId);
  }, [lastScreenshotTime]);

  const formatTime = (seconds) => {
    if (!seconds) return '00:00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="timer-container">
      <div className="timer-card">
        <div className="timer-header">
          <h3>Current Session</h3>
          <span>{format(new Date(), 'MMM d, yyyy - HH:mm')}</span>
        </div>
        <div className="timer-display">{timeFormatted || '00:00:00'}</div>
      </div>

      <div className="stats-card">
        <h3>Activity Stats</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Keyboard Presses:</span>
            <span className="stat-value">{keyboardCount || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Mouse Clicks:</span>
            <span className="stat-value">{mouseCount || 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Last Screenshot:</span>
            <span className="stat-value">{lastScreenshotAgo}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Session Time:</span>
            <span className="stat-value">{formatTime(timer?.elapsedTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimerDisplay;