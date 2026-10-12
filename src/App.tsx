import { useEffect } from 'react';
import { detectLang, setLang, useLang } from './coach/i18n/i18n';
import { getStore } from './coach/storage';
import { useRoute } from './ui/nav';
import { AnalysisScreen } from './ui/screens/AnalysisScreen';
import { CaptureScreen } from './ui/screens/CaptureScreen';
import { CompareScreen } from './ui/screens/CompareScreen';
import { DiagnoseScreen } from './ui/screens/DiagnoseScreen';
import { HistoryScreen } from './ui/screens/HistoryScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { TrainingScreen } from './ui/screens/TrainingScreen';

export function App() {
  const route = useRoute();
  useLang(); // re-render everything on language change

  useEffect(() => {
    setLang(detectLang());
    getStore()
      .then((s) => s.getSettings())
      .then((st) => st.lang && setLang(st.lang))
      .catch(() => {});
  }, []);

  switch (route.name) {
    case 'capture':
      return <CaptureScreen route={route} />;
    case 'analysis':
      return <AnalysisScreen route={route} />;
    case 'training':
      return <TrainingScreen route={route} />;
    case 'history':
      return <HistoryScreen route={route} />;
    case 'compare':
      return <CompareScreen route={route} />;
    case 'diagnose':
      return <DiagnoseScreen route={route} />;
    case 'settings':
      return <SettingsScreen route={route} />;
    default:
      return <HomeScreen />;
  }
}
