import { describe, expect, it } from 'vitest'

import { padForSaddleStitch } from './sequence'

function pages(count: number, coverAt: number[] = []) {
  return Array.from({ length: count }, (_, position) => ({
    id: `p${position + 1}`,
    position,
    isCover: coverAt.includes(position) || undefined,
  }))
}

/** The padded sequence as page ids, with "_" for each blank. */
function layout(frames: ReturnType<typeof pages>) {
  return padForSaddleStitch(frames).map((page) => (page.kind === 'blank' ? '_' : page.frame.id))
}

describe('padForSaddleStitch', () => {
  it.each([
    [10, 12],
    [12, 12],
    [13, 16],
    [1, 4],
  ])('pads %i pages to %i', (count, padded) => {
    expect(padForSaddleStitch(pages(count))).toHaveLength(padded)
  })

  it('adds blanks at the end of the book', () => {
    expect(layout(pages(10))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', '_', '_'])
  })

  it('adds blanks just before a back cover, so it stays the last page', () => {
    expect(layout(pages(10, [0, 9]))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', '_', '_', 'p10'])
  })

  it('a front cover alone does not move the blanks', () => {
    expect(layout(pages(6, [0])).slice(-2)).toEqual(['_', '_'])
  })

  it('a single cover page is padded after, not before', () => {
    expect(layout(pages(1, [0]))).toEqual(['p1', '_', '_', '_'])
  })

  it('follows page position, not array order, and adds nothing to a multiple of 4', () => {
    const shuffled = [...pages(4)].reverse()
    expect(layout(shuffled)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('pads nothing when there are no pages', () => {
    expect(padForSaddleStitch([])).toEqual([])
  })
})
