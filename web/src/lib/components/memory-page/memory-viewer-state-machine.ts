import type { MemoryAsset } from '$lib/stores/memory.store.svelte';
import { Tween } from 'svelte/motion';
import { and, assign, emit, enqueueActions, fromPromise, not, setup } from 'xstate';

type StateMachineContext = {
  isVideo: boolean;
  galleryAndViewerClosed: boolean;
  currentMemoryAsset: MemoryAsset | undefined;
  videoElement: HTMLVideoElement | undefined;
  photoProgressController: Tween<number> | undefined;
  durationMs: number;
  elapsedMs: number;
};
type ContextInput = {
  input: StateMachineContext;
};

export const memoryViewerMachine = setup({
  types: {
    context: {} as StateMachineContext,
  },
  actors: {
    initAsset: fromPromise(async ({ input }: ContextInput) => {
      await input.photoProgressController?.set(0);
    }),
    pauseAsset: fromPromise(async ({ input }: ContextInput) => {
      if (input.isVideo) {
        input.videoElement?.pause();
      } else {
        await input.photoProgressController?.set(input.photoProgressController?.current);
      }
    }),
    playAsset: fromPromise(async ({ input }: ContextInput) => {
      await (input.isVideo ? input.videoElement?.play() : input.photoProgressController?.set(1));
    }),
  },
  guards: {
    hasNextAsset: ({ context }) => !!(context.currentMemoryAsset && context.currentMemoryAsset.next),
    hasPreviousAsset: ({ context }) => !!(context.currentMemoryAsset && context.currentMemoryAsset.previous),
    hasFinishedPlayback: ({ context }) => context.elapsedMs === context.durationMs,
    isGalleryAndViewerClosed: ({ context }) => context.galleryAndViewerClosed,
    isGalleryOrViewerOpen: ({ context }) => !context.galleryAndViewerClosed,
  },
}).createMachine({
  context: {
    isVideo: false,
    galleryAndViewerClosed: true,
    currentMemoryAsset: undefined,
    videoElement: undefined,
    photoProgressController: undefined,
    durationMs: 0,
    elapsedMs: 0,
  },
  on: {
    GALLERY_VIEWER_TOGGLED: {
      description:
        'When either the gallery or asset viewer are displayed, then playback should stop. Similarly we should resume play when they are closed.',
      actions: enqueueActions(({ event, enqueue }) => {
        enqueue.assign({ galleryAndViewerClosed: event.galleryAndViewerClosed });
        if (event.galleryAndViewerClosed) {
          enqueue.raise({ type: 'PLAY' });
        }
      }),
    },
  },
  id: 'memory-viewer',
  initial: 'loading_memories',
  states: {
    loading_memories: {
      description:
        'The entry state of the memory viewer, during which memories are being fetched from the remote backend.',
      on: {
        FAIL: {
          target: 'failure',
          actions: [({ event }) => console.error(`Error initialising memories: ${event.error}`)],
        },
        LOADED: {
          target: 'init_asset',
          actions: assign(({ event }) => ({ currentMemoryAsset: event.currentMemoryAsset })),
        },
      },
    },
    failure: {
      type: 'final',
    },
    init_asset: {
      description: 'Sets up the state machine context with the newly loaded asset.',
      invoke: {
        src: 'initAsset',
        input: ({ context }) => context,
      },
      on: {
        ASSET_READY: {
          target: 'ready',
          actions: [
            assign(({ event }) => {
              return {
                isVideo: event.isVideo,
                videoElement: event.isVideo ? event.videoElement : undefined,
                photoProgressController: event.isVideo ? undefined : event.photoProgressController,
                durationMs: event.isVideo ? event.videoElement.duration * 1000 : event.durationMs,
                elapsedMs: 0,
              };
            }),
            emit({ type: 'navigate_to_asset' }),
          ],
        },
      },
    },
    ready: {
      initial: 'playing',
      on: {
        NEXT: [
          {
            guard: 'hasNextAsset',
            target: 'init_asset',
            actions: assign({
              currentMemoryAsset: (context) => context.context?.currentMemoryAsset?.next,
            }),
          },
          {
            guard: and([not('hasNextAsset'), 'hasFinishedPlayback']),
            target: 'ready.paused',
          },
        ],
        PREVIOUS: {
          guard: 'hasPreviousAsset',
          target: 'init_asset',
          actions: assign({
            currentMemoryAsset: (state) => state.context?.currentMemoryAsset?.previous,
          }),
        },
        NAVIGATE: {
          description: 'Used when jumping to a specific asset (either via URL navigation or by clicking)',
          target: 'init_asset',
          actions: assign(({ event }) => ({
            currentMemoryAsset: event.targetMemoryAsset,
          })),
        },
      },
      states: {
        playing: {
          guard: 'isGalleryAndViewerClosed',
          invoke: {
            src: 'playAsset',
            input: ({ context }) => context,
          },
          on: {
            PAUSE: {
              target: 'paused',
            },
            TIMING: [
              {
                description: 'A special type of event used to updated timing information in the state machine',
                guard: 'isGalleryAndViewerClosed',
                target: 'playing',
                actions: assign(({ event }) => ({
                  elapsedMs: event.elapsedMs,
                })),
              },
              {
                description: 'If the gallery or asset viewer is open, we should auto-pause playback.',
                guard: 'isGalleryOrViewerOpen',
                target: 'paused',
              },
            ],
          },
        },
        paused: {
          invoke: {
            src: 'pauseAsset',
            input: ({ context }) => context,
          },
          on: {
            PLAY: {
              target: 'playing',
            },
          },
        },
      },
    },
  },
});
