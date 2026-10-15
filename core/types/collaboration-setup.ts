/** Private launcher/Session setup information; never exposed by an authority. */
export interface CollaborationSetupStatus {
  platform: string;
  appVersion: string;
  cloudflared: {
    /** An executable was found; its authentication and connectivity are untested. */
    installed: boolean;
  };
  /** Absolute path to the instructions shipped with this Pneuma installation. */
  guidePath: string;
}
