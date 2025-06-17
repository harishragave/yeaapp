// src/components/TimerControls.js
import React from 'react';
import { useTaskContext } from '../contexts/TaskContext';

const TimerControls = () => {
  const { 
    isTracking, 
    isPaused, 
    startTimer, 
    pauseTimer, 
    resumeTimer, 
    stopTimer 
  } = useTaskContext();

  return (
    <div className="timer-controls">
      {!isTracking ? (
        <button onClick={startTimer} className="control-button start">
          Start Tracking
        </button>
      ) : (
        <div className="controls-group">
          {!isPaused ? (
            <button onClick={pauseTimer} className="control-button pause">
              Pause
            </button>
          ) : (
            <button onClick={resumeTimer} className="control-button resume">
              Resume
            </button>
          )}
          <button onClick={stopTimer} className="control-button stop">
            Stop
          </button>
        </div>
      )}
    </div>
  );
};

export default TimerControls;