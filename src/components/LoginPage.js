import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Eye, EyeOff, User, Lock, Moon, Sun, X } from 'lucide-react';
import '../styles/LoginPage.css';

const LoginPage = ({ onLogin, onQuitClick }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear error when user starts typing
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.username || !formData.password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Simulate API call - replace with your actual authentication logic
      await new Promise(resolve => setTimeout(resolve, 1000));

      // For demo purposes, accept any non-empty credentials
      // In a real app, you'd validate against your backend
      if (formData.username.trim() && formData.password.trim()) {
        onLogin({
          username: formData.username,
          email: `${formData.username}@example.com`
        });
      } else {
        setError('Invalid credentials');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  const handleQuit = async () => {
    try {
      if (window.electronAPI && window.electronAPI.quitApp) {
        // Call your custom quit handler first (if needed)
        if (onQuitClick) {
          onQuitClick();
        }
        // Then quit the Electron app
        await window.electronAPI.quitApp();
      } else {
        console.warn('Electron quit function not available');
        // Fallback for non-Electron environments
        if (onQuitClick) {
          onQuitClick();
        }
      }
    } catch (error) {
      console.error('Failed to quit application:', error);
    }
  };
  return (
    <div className={`login-page ${isDarkMode ? 'dark' : 'light'}`}>
      {/* Top Controls */}
      <div className="login-top-controls">
        <button
          onClick={toggleTheme}
          className="theme-toggle-btn"
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          onClick={handleQuit}
          className="quit-btn"
          title="Quit Application"
        >
          <X size={18} />
        </button>
      </div>

      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="logo">
              <div className="logo-icon">⏰</div>
              <h1>TaskTracker</h1>
            </div>
            <p className="login-subtitle">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} />
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  placeholder="Enter your username"
                  className="form-input"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="Enter your password"
                  className="form-input"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="password-toggle"
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="loading-spinner"></div>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="login-footer">
            <p>Demo Credentials: Any username/password will work</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;