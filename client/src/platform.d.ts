export {};
declare global {
  interface Window {
    __MANUS_CONFIG__?: {
      projectId: string; apiUrl: string; apiBrowserKey: string;
    };
  }
}
