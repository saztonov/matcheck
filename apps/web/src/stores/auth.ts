import { create } from 'zustand';
import type { UserDto } from '@matcheck/contracts';

type AuthState = {
  accessToken: string | null;
  user: UserDto | null;
  sessionExpired: boolean;
  setAccessToken: (token: string | null) => void;
  setUser: (user: UserDto | null) => void;
  setAuth: (token: string, user: UserDto) => void;
  clear: () => void;
  expireSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  sessionExpired: false,
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  setAuth: (accessToken, user) => set({ accessToken, user, sessionExpired: false }),
  clear: () => set({ accessToken: null, user: null, sessionExpired: false }),
  expireSession: () => set({ accessToken: null, user: null, sessionExpired: true }),
}));
