import { useEffect, type ReactNode } from 'react';
import { detectLang, setLang, useLang } from './coach/i18n/i18n';
import { loadSettings } from './coach/storage/settings';
import { useRoute } from './ui/nav';
import { OfflineHint } from './ui/components/OfflineHint';
import { AnalysisScreen } from './ui/screens/AnalysisScreen';
import { CaptureScreen } from './ui/screens/CaptureScreen';
import { CompareScreen } from './ui/screens/CompareScreen';
import { DiagnoseScreen } from './ui/screens/DiagnoseScreen';
import { HistoryScreen } from './ui/screens/HistoryScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { TrainingScreen } from './ui/screens/TrainingScreen';

// Phone language right away (no flash of English on German phones); the saved choice follows once storage has answered.
setLang(detectLang());

export function App() {
  const route = useRoute();
  useLang(); // re-render everything on language change

  useEffect(() => {
    // saved language wins; a player who never chose one gets the phone language (defaultSettings)
    void loadSettings().then((st) => setLang(st.lang));
  }, []);

  let screen: ReactNode;
  switch (route.name) {
    case 'capture':
      screen = <CaptureScreen route={route} />;
      break;
    case 'analysis':
      screen = <AnalysisScreen route={route} />;
      break;
    case 'training':
      screen = <TrainingScreen route={route} />;
      break;
    case 'history':
      screen = <HistoryScreen route={route} />;
      break;
    case 'compare':
      screen = <CompareScreen route={route} />;
      break;
    case 'diagnose':
      screen = <DiagnoseScreen route={route} />;
      break;
    case 'settings':
      screen = <SettingsScreen route={route} />;
      break;
    default:
      screen = <HomeScreen />;
  }
  return (
    <>
      {screen}
      <OfflineHint />
    </>
  );
}
