import { describe, it, expect, beforeEach } from 'vitest'
import { Playlist } from '../Playlist'
import type { Media } from '../../../../types/media'

function makeMedia(path: string, name?: string): Media {
  return { path, name: name ?? path.split('/').pop() ?? path }
}

describe('Playlist', () => {
  let playlist: Playlist

  beforeEach(() => {
    playlist = new Playlist()
  })

  // ─────────────────────────────────────────────
  // getNext()
  // ─────────────────────────────────────────────

  describe('getNext()', () => {
    it('empty list returns null', () => {
      expect(playlist.getNext()).toBeNull()
    })

    it('single item + loop mode (default): returns itself', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.setCurrentByIndex(0)
      // isLoop defaults to true
      expect(playlist.getNext()?.path).toBe('/a.mp4')
    })

    it('single item + non-loop mode: returns null', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.setCurrentByIndex(0)
      playlist.toggleLoop() // true → false
      expect(playlist.getNext()).toBeNull()
    })

    it('multiple items: middle item returns next item', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(1)
      expect(playlist.getNext()?.path).toBe('/c.mp4')
    })

    it('multiple items + loop mode (default): last returns first', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(2)
      expect(playlist.getNext()?.path).toBe('/a.mp4')
    })

    it('multiple items + non-loop mode: last returns null', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.setCurrentByIndex(1)
      playlist.toggleLoop() // true → false
      expect(playlist.getNext()).toBeNull()
    })

    it('single-loop mode: returns current item', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(1)
      playlist.setSingleLoop(true)
      expect(playlist.getNext()?.path).toBe('/b.mp4')
    })

    it('currentIndex < 0: returns first item', () => {
      playlist.clear()
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      // currentIndex is -1 after clear + add (never set)
      expect(playlist.getNext()?.path).toBe('/a.mp4')
    })
  })

  // ─────────────────────────────────────────────
  // getPrev()
  // ─────────────────────────────────────────────

  describe('getPrev()', () => {
    it('empty list returns null', () => {
      expect(playlist.getPrev()).toBeNull()
    })

    it('multiple items: middle item returns previous item', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(2)
      expect(playlist.getPrev()?.path).toBe('/b.mp4')
    })

    it('loop mode (default): first returns last item', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(0)
      expect(playlist.getPrev()?.path).toBe('/c.mp4')
    })

    it('non-loop mode: first item returns null', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.setCurrentByIndex(0)
      playlist.toggleLoop() // true → false
      expect(playlist.getPrev()).toBeNull()
    })

    it('single-loop mode: returns current item', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.setCurrentByIndex(1)
      playlist.setSingleLoop(true)
      expect(playlist.getPrev()?.path).toBe('/b.mp4')
    })
  })

  // ─────────────────────────────────────────────
  // toggleLoop / setSingleLoop / toggleShuffle
  // ─────────────────────────────────────────────

  describe('toggleLoop()', () => {
    it('initially true (default loop), one call becomes false', () => {
      expect(playlist.getLoop()).toBe(true)
      expect(playlist.toggleLoop()).toBe(false)
    })

    it('two consecutive calls restores to true', () => {
      playlist.toggleLoop()
      expect(playlist.toggleLoop()).toBe(true)
    })
  })

  describe('setSingleLoop()', () => {
    it('setSingleLoop reflects the value', () => {
      expect(playlist.getSingleLoop()).toBe(false)
      playlist.setSingleLoop(true)
      expect(playlist.getSingleLoop()).toBe(true)
      playlist.setSingleLoop(false)
      expect(playlist.getSingleLoop()).toBe(false)
    })
  })

  describe('toggleShuffle()', () => {
    it('initially false, one call becomes true', () => {
      expect(playlist.getShuffle()).toBe(false)
      expect(playlist.toggleShuffle()).toBe(true)
    })

    it('toggle on then off restores original order', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(0)
      playlist.toggleShuffle()
      playlist.toggleShuffle()
      const paths = playlist.get().map((m) => m.path)
      expect(paths).toEqual(['/a.mp4', '/b.mp4', '/c.mp4'])
    })
  })

  // ─────────────────────────────────────────────
  // set()
  // ─────────────────────────────────────────────

  describe('set()', () => {
    it('new list has correct length', () => {
      playlist.set([makeMedia('/a.mp4'), makeMedia('/b.mp4')])
      expect(playlist.length).toBe(2)
    })

    it('dedup: duplicate paths keep only first', () => {
      playlist.set([makeMedia('/a.mp4'), makeMedia('/a.mp4'), makeMedia('/b.mp4')])
      expect(playlist.length).toBe(2)
    })

    it('keeps current item path unchanged', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.setCurrentByIndex(1)
      playlist.set([makeMedia('/a.mp4'), makeMedia('/b.mp4')])
      expect(playlist.getCurrent()?.path).toBe('/b.mp4')
    })

    it('current item not in new list: currentIndex resets to 0', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.setCurrentByIndex(0)
      playlist.set([makeMedia('/c.mp4'), makeMedia('/d.mp4')])
      expect(playlist.getCurrent()?.path).toBe('/c.mp4')
    })

    it('empty list: getCurrent returns null', () => {
      playlist.set([makeMedia('/a.mp4')])
      playlist.set([])
      expect(playlist.getCurrent()).toBeNull()
    })
  })

  // ─────────────────────────────────────────────
  // add()
  // ─────────────────────────────────────────────

  describe('add()', () => {
    it('add item increases length', () => {
      playlist.add(makeMedia('/a.mp4'))
      expect(playlist.length).toBe(1)
    })

    it('duplicate path not added again', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/a.mp4'))
      expect(playlist.length).toBe(1)
    })

    it('different paths each add', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      expect(playlist.length).toBe(2)
    })
  })

  // ─────────────────────────────────────────────
  // remove()
  // ─────────────────────────────────────────────

  describe('remove()', () => {
    it('remove decreases length', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.remove(0)
      expect(playlist.length).toBe(1)
      expect(playlist.get()[0].path).toBe('/b.mp4')
    })

    it('remove item before current: currentIndex decrements by 1', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(2)
      playlist.remove(0)
      expect(playlist.getCurrent()?.path).toBe('/c.mp4')
    })

    it('remove last item: currentIndex adjusts', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.setCurrentByIndex(1)
      playlist.remove(1)
      expect(playlist.getCurrent()?.path).toBe('/a.mp4')
    })

    it('out-of-bounds index does not throw', () => {
      playlist.add(makeMedia('/a.mp4'))
      expect(() => playlist.remove(5)).not.toThrow()
      expect(playlist.length).toBe(1)
    })
  })

  // ─────────────────────────────────────────────
  // moveItem()
  // ─────────────────────────────────────────────

  describe('moveItem()', () => {
    it('move backward: order is correct', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.moveItem(0, 2)
      const paths = playlist.get().map((m) => m.path)
      expect(paths).toEqual(['/b.mp4', '/c.mp4', '/a.mp4'])
    })

    it('move forward: order is correct', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.moveItem(2, 0)
      const paths = playlist.get().map((m) => m.path)
      expect(paths).toEqual(['/c.mp4', '/a.mp4', '/b.mp4'])
    })

    it('moving current item: currentIndex follows', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      playlist.add(makeMedia('/c.mp4'))
      playlist.setCurrentByIndex(0)
      playlist.moveItem(0, 2)
      expect(playlist.getCurrent()?.path).toBe('/a.mp4')
    })

    it('out-of-bounds index returns false', () => {
      playlist.add(makeMedia('/a.mp4'))
      expect(playlist.moveItem(0, 5)).toBe(false)
      expect(playlist.moveItem(-1, 0)).toBe(false)
    })

    it('valid move returns true', () => {
      playlist.add(makeMedia('/a.mp4'))
      playlist.add(makeMedia('/b.mp4'))
      expect(playlist.moveItem(0, 1)).toBe(true)
    })
  })
})
