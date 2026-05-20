import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ChatbotPage from './pages/ChatbotPage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import KitchenPage from './pages/KitchenPage';
import DriverPage from './pages/DriverPage';

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ChatbotPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={
            <ProtectedRoute roles={['ADMIN']}>
              <AdminPage />
            </ProtectedRoute>
          } />
          <Route path="/kitchen" element={
            <ProtectedRoute roles={['ADMIN', 'COCINA']}>
              <KitchenPage />
            </ProtectedRoute>
          } />
          <Route path="/driver" element={
            <ProtectedRoute roles={['ADMIN', 'REPARTIDOR']}>
              <DriverPage />
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
