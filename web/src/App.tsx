import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RedirectIfAuthed, RequireAuth } from "./components/guards";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { EstimatesPage } from "./pages/EstimatesPage";
import { EstimateDetailPage } from "./pages/EstimateDetailPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { NormativePage } from "./pages/NormativePage";
import { AssistantPage } from "./pages/AssistantPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectIfAuthed>
            <RegisterPage />
          </RedirectIfAuthed>
        }
      />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="estimates" element={<EstimatesPage />} />
          <Route path="estimates/:id" element={<EstimateDetailPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="normative" element={<NormativePage />} />
          <Route path="assistant" element={<AssistantPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
