import React, { useState, useEffect } from 'react';
import LoginForm from './components/LoginForm';
import ConsumptionChart from './components/ConsumptionChart';
import PlanInfo from './components/PlanInfo';
import Settings from './components/Settings';
import axios from 'axios';

// Configure Axios base URL based on dev vs production build
axios.defaults.baseURL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3000') 
  : '';

import {
  Spinner,
  Button,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Avatar,
  Text,
  tokens,
  makeStyles,
} from '@fluentui/react-components';
import {
  DataBarVertical24Regular,
  Settings24Regular,
  SignOut24Regular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem 2rem',
    maxWidth: '1280px',
    margin: '0 auto',
    gap: '2rem',
  },
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '1.25rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  brandIcon: {
    background: `linear-gradient(135deg, ${tokens.colorBrandBackground}, ${tokens.colorBrandBackground2})`,
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: tokens.shadow4,
    fontSize: '24px',
    color: 'white',
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '3rem',
  },
  footer: {
    paddingTop: '2rem',
    textAlign: 'center',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  splashCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
});

const App: React.FC = () => {
  const styles = useStyles();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    axios.get('/status')
      .then(res => setIsLoggedIn(res.data.logged_in === true))
      .catch(() => setIsLoggedIn(false));
  }, []);

  if (isLoggedIn === null) {
    return (
      <div className={styles.splashCenter}>
        <Spinner size="extra-large" label="Connecting to Helen…" />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* ── Nav ── */}
      <nav className={styles.nav}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <DataBarVertical24Regular />
          </div>
          <Text size={600} weight="semibold" style={{ letterSpacing: '-0.5px' }}>
            HelenFlow
          </Text>
        </div>

        {isLoggedIn && (
          <div className={styles.navActions}>
            <Button
              appearance="subtle"
              icon={<Settings24Regular />}
              onClick={() => setShowSettings(true)}
              title="Settings"
            />
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Avatar name="User" size={32} style={{ cursor: 'pointer' }} color="brand" />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<SignOut24Regular />} onClick={() => setIsLoggedIn(false)}>
                    Sign out
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        )}
      </nav>

      {/* ── Main content ── */}
      <main className={styles.main}>
        {!isLoggedIn ? (
          <LoginForm onLoginSuccess={() => setIsLoggedIn(true)} />
        ) : (
          <>
            <ConsumptionChart />
            <PlanInfo />
          </>
        )}
      </main>

      {/* ── Settings panel ── */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>
          © 2026 HelenFlow Data Collector — Built with Rust & React
        </Text>
      </footer>
    </div>
  );
};

export default App;
