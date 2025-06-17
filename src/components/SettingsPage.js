import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useTaskContext } from '../contexts/TaskContext';
import Navbar from './Navbar';
import { format } from 'date-fns';
import { ChevronLeft } from 'lucide-react';
import '../styles/SettingsPage.css';

const SettingsPage = ({ onBackClick, onQuitClick }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  const { stats } = useTaskContext();
  
  const [warnings] = useState([
    {
      id: 1,
      type: 'Screenshot Warning',
      message: 'Blank screenshot detected at 14:35.',
      time: '2 hours ago',
    },
    {
      id: 2,
      type: 'Activity Warning',
      message: 'No activity detected for more than 15 minutes.',
      time: '1 day ago',
    },
    {
      id: 3,
      type: 'Break Warning',
      message: 'Break time exceeded 1 hour limit.',
      time: '2 days ago',
    },
  ]);

  return (
    <div className="settings-page">
      <Navbar 
        title="Settings"
        onSettingsClick={onBackClick}
        onQuitClick={onQuitClick}
      />
      <div className="settings-container">
        <button 
          onClick={onBackClick}
          className="back-button"
          title="Go back"
        >
          <ChevronLeft className="icon" />
          Back
        </button>
        <div className="settings-content">
          <div className="settings-section">
            <h2>Appearance</h2>
            <div className="setting-item">
              <span>Dark Mode</span>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={isDarkMode} 
                  onChange={toggleTheme} 
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h2>User Account</h2>
            <div className="user-profile">
              <div className="user-avatar">U</div>
              <div className="user-info">
                <div className="user-name">Demo User</div>
                <div className="user-email">demo@example.com</div>
              </div>
              <button className="signout-button">Sign Out</button>
            </div>
          </div>

          <div className="settings-section">
            <h2>Activity Monitoring</h2>
            <div className="stats-grid">
              <div className="stat-item">
                <span>Keyboard Count</span>
                <span className="stat-value">{stats?.keyPresses || 0}</span>
              </div>
              <div className="stat-item">
                <span>Mouse Movements</span>
                <span className="stat-value">{stats?.mouseMoves || 0}</span>
              </div>
              <div className="stat-item full-width">
                <span>Last Screenshot</span>
                <span className="stat-value">
                  {stats?.lastScreenshotTime 
                    ? format(new Date(stats.lastScreenshotTime), 'MMM d, yyyy HH:mm:ss')
                    : 'None'}
                </span>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2>Warnings</h2>
            {warnings.length === 0 ? (
              <div className="no-warnings">No warnings to display</div>
            ) : (
              <div className="warnings-list">
                {warnings.map(warning => (
                  <div key={warning.id} className="warning-item">
                    <div className="warning-header">
                      <span className="warning-type">{warning.type}</span>
                      <span className="warning-time">{warning.time}</span>
                    </div>
                    <p className="warning-message">{warning.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
