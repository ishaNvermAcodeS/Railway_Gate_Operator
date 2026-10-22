import { useEffect, useState } from 'react';
import { Home } from './ui/Home';
import { Playground } from './ui/Playground';
import { RailwayLab } from './ui/RailwayLab';
import { ThemeContext, useThemeState } from './ui/theme';

type Route = 'home' | 'railway' | 'playground';

function routeFromHash(): Route {
  if (location.hash.startsWith('#/railway')) return 'railway';
  if (location.hash.startsWith('#/playground')) return 'playground';
  return 'home';
}

export default function App() {
  const theme = useThemeState();
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <ThemeContext.Provider value={theme}>
      {route === 'railway' ? <RailwayLab /> : route === 'playground' ? <Playground /> : <Home />}
    </ThemeContext.Provider>
  );
}
