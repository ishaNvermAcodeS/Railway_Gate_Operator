import { useEffect, useState } from 'react';
import { Home } from './ui/Home';
import { RailwayLab } from './ui/RailwayLab';

type Route = 'home' | 'railway';

const routeFromHash = (): Route => (location.hash.startsWith('#/railway') ? 'railway' : 'home');

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route === 'railway' ? <RailwayLab /> : <Home />;
}
