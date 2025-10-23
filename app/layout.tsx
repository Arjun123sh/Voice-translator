"use client";
import './globals.css';
import { ReactNode } from 'react';
import Container from '@mui/material/Container';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Container maxWidth="md" style={{ padding: 20 }}>
          {children}
        </Container>
      </body>
    </html>
  );
}