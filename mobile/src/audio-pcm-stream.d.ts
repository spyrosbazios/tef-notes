// @fugood/react-native-audio-pcm-stream ships its types under its upstream name.
declare module "@fugood/react-native-audio-pcm-stream" {
  const LiveAudioStream: {
    init(o: { sampleRate: number; channels: number; bitsPerSample: number; audioSource?: number; bufferSize?: number; wavFile: string }): void;
    start(): void;
    stop(): Promise<string>;
    on(event: "data", cb: (base64: string) => void): void;
  };
  export default LiveAudioStream;
}
