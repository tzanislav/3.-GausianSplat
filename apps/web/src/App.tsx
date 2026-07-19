import { AuthProvider } from './auth.js';
import { HomePage } from './pages/HomePage.js';
import { ProjectEditorPage } from './pages/ProjectEditorPage.js';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage.js';
import { PublicShareViewerPage } from './pages/PublicShareViewerPage.js';

export function App() {
  const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);
  if (shareMatch) return <PublicShareViewerPage token={shareMatch[1]!} />;

  return (
    <AuthProvider>
      <ApplicationRouter />
    </AuthProvider>
  );
}

function ApplicationRouter() {
  const path = window.location.pathname;
  const settingsMatch = path.match(/^\/projects\/([^/]+)\/settings$/);
  const editorMatch = path.match(/^\/projects\/([^/]+)\/editor$/);

  if (settingsMatch) return <ProjectSettingsPage projectId={settingsMatch[1]!} />;
  if (editorMatch) return <ProjectEditorPage projectId={editorMatch[1]!} />;
  return <HomePage />;
}
