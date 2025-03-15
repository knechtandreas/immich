import type { MemoryAsset } from '$lib/stores/memory.store.svelte';
import { Tween } from 'svelte/motion';
import { and, assign, emit, fromPromise, not, raise, setup } from 'xstate';

type StateMachineContext = {
  isVideo: boolean,
  galleryAndViewerClosed: boolean,
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
      actions: [
        assign(({ event }) => ({ galleryAndViewerClosed: event.galleryAndViewerClosed })),
        raise(({ event }) => ({ type: event.galleryAndViewerClosed ? 'PLAY' : 'PAUSE' })),
      ],
    },
  },
  id: 'memory-viewer',
  initial: 'loading_memories',
  states: {
    loading_memories: {
      on: {
        FAIL: {
          target: 'failure',
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
            target: 'init_asset',
            guard: 'hasNextAsset',
            actions: assign({
              currentMemoryAsset: (context) => context.context?.currentMemoryAsset?.next,
            }),
          },
          {
            target: 'ready.paused',
            guard: and([not('hasNextAsset'), 'hasFinishedPlayback']),
          },
        ],
        PREVIOUS: {
          target: 'init_asset',
          guard: 'hasPreviousAsset',
          actions: assign({
            currentMemoryAsset: (state) => state.context?.currentMemoryAsset?.previous,
          }),
        },
        NAVIGATE: {
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
                guard: 'isGalleryAndViewerClosed',
                target: 'playing',
                actions: assign(({ event }) => ({
                  elapsedMs: event.elapsedMs,
                })),
              },
              {
                guard: not('isGalleryAndViewerClosed'),
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
