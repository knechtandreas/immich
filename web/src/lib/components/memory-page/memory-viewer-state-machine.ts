import type { MemoryAsset } from '$lib/stores/memory.store.svelte';
import { and, assign, emit, enqueueActions, not, setup } from 'xstate';

type StateMachineContext = {
  galleryAndViewerClosed: boolean;
  currentMemoryAsset: MemoryAsset | undefined;
  durationMs: number;
  elapsedMs: number;
};

export const memoryViewerMachine = setup({
  types: {
    context: {} as StateMachineContext,
  },
  guards: {
    hasNextAsset: ({ context }) => !!(context.currentMemoryAsset && context.currentMemoryAsset.next),
    hasPreviousAsset: ({ context }) => !!(context.currentMemoryAsset && context.currentMemoryAsset.previous),
    hasFinishedPlayback: ({ context }) => context.elapsedMs === context.durationMs,
    isGalleryAndViewerClosed: ({ context }) => context.galleryAndViewerClosed,
    isGalleryOrViewerOpen: ({ context }) => !context.galleryAndViewerClosed,
    isDifferentAsset: ({ context, event }) => context.currentMemoryAsset?.asset.id !== event.targetMemoryAsset.asset.id,
  },
}).createMachine({
  context: {
    galleryAndViewerClosed: true,
    currentMemoryAsset: undefined,
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
      entry: emit({ type: 'reset_player' }),
      on: {
        ASSET_READY: {
          target: 'ready',
          actions: [
            assign(({ event }) => {
              return {
                durationMs: event.durationMs,
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
          guard: 'isDifferentAsset',
          target: 'init_asset',
          actions: assign(({ event }) => ({
            currentMemoryAsset: event.targetMemoryAsset,
          })),
        },
      },
      states: {
        playing: {
          guard: 'isGalleryAndViewerClosed',
          entry: emit({ type: 'start_player' }),
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
          entry: emit({ type: 'pause_player' }),
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
