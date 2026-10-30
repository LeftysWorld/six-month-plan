import type { ExerciseDemo, StretchHold, StretchPlan } from '@six/core';

/**
 * Pictures for the Splits & Backbend holds the exercise library doesn't have, chosen by you
 * (Oct 30 2026). Shown by See how in the stretching log. Matched by the hold's name, so a hold
 * renamed slightly still gets its picture; the measurements ("Front split (left): …") don't.
 */
export const STRETCH_PICTURES: { label: string; test: RegExp; url: string }[] = [
  {
    label: 'Pike fold',
    test: /pike fold/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fwww.12minuteathlete.com%2Fwp-content%2Fuploads%2F2019%2F06%2Fflexibility-challenge-pike-stretch-1024x768.jpg&f=1&nofb=1&ipt=4cdc77b74057239fd701be11dfd23acc0d2a35df9a8834fb8b6ae4e5a9e95018&ipo=images',
  },
  {
    label: 'Front splits (both)',
    test: /^front split,/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fwww.wikihow.com%2Fimages%2Fthumb%2F6%2F6e%2FDo-Forward-Splits-Step-7-Version-5.jpg%2F550px-nowatermark-Do-Forward-Splits-Step-7-Version-5.jpg&f=1&nofb=1&ipt=e20d3c15b316d1bc49e1e4fee35a555d5d65e34bbf469fe9255482394a12f4a4&ipo=images',
  },
  {
    label: 'Frog stretch',
    test: /frog/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fwww.athletico.com%2Fwp-content%2Fuploads%2F2017%2F11%2Fstretch-of-the-week-frog-stretch.jpg&f=1&nofb=1&ipt=b8dd88ee08a0532604d12a6316d65de8337760b04b85fe5c7344bad71f10d2ed&ipo=images',
  },
  {
    label: 'Side split',
    test: /^side split/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Ftorokhtiy.com%2Fwp-content%2Fuploads%2F2023%2F11%2Fimage-220-1024x683.jpeg&f=1&nofb=1&ipt=55af85f3529428f42ea6a8b9392f0a761066aafd229b49bc5113a4784c7e1f4b&ipo=images',
  },
  {
    label: 'Lying butterfly',
    test: /butterfly/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fwww.fitsri.com%2Fwp-content%2Fuploads%2F2022%2F04%2FSupta-Baddhakonasana-with-blocks-1024x683.jpg&f=1&nofb=1&ipt=67ba4c616303817f2378c9e84c10308aa1a13fda3fe4ecc0f8091c3e7c31fa85&ipo=images',
  },
  {
    label: 'Standing fold',
    test: /standing fold|standing chest to shins/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fjulielohre.com%2Fwp-content%2Fuploads%2F2025%2F06%2FForward-Fold-Progression-1-1200x675.jpg&f=1&nofb=1&ipt=d7bd1152892c13de506eeb7d7801c021268fdfe819972b6731cb1d944b8c2c21&ipo=images',
  },
  {
    label: 'Sphinx to cobra',
    test: /sphinx/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fi.pinimg.com%2Foriginals%2F78%2F6f%2Fa0%2F786fa0b4af4074a459a21a4fc84ac6f9.jpg&f=1&nofb=1&ipt=c9365a50781adc85c0874afca409901cd7fcc8591c8cdeffc339e695298bf5a5&ipo=images',
  },
  {
    label: 'Puppy pose (melting heart)',
    test: /puppy|melting heart/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fthumbs.dreamstime.com%2Fz%2Fyoung-female-handsome-yoga-instructor-does-asanas-nature-relaxes-exercises-anahatasana-melting-heart-pose-puppy-219565745.jpg&f=1&nofb=1&ipt=19c53cdb30248527e334005f2fbf2af0ddbe44dae55dd73fb3f85157ee996ce2&ipo=images',
  },
  {
    label: 'Bridge holds',
    test: /bridge/i,
    url: 'https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fmindbodygreen-res.cloudinary.com%2Fimage%2Fupload%2Fc_fill%2Cw_2000%2Ch_1200%2Cg_auto%2Cfl_lossy%2Cf_jpg%2Forg%2F81ulay4jwk5e8tvf8.jpg&f=1&nofb=1&ipt=0f1677a738559510333550c5df67ef8475a5e06efd27ee1673a1e22b9fb53232&ipo=images',
  },
];

/** The picture for a hold, by its name, or null. */
export function pictureFor(name: string): ExerciseDemo | null {
  const p = STRETCH_PICTURES.find((x) => x.test.test(name.trim()));
  return p ? { kind: 'video', url: p.url } : null;
}

/** A hold with its picture, unless it already shows something (yours wins). */
export function withPicture(hold: StretchHold): StretchHold {
  if (hold.demo) return hold;
  const demo = pictureFor(hold.name);
  return demo ? { ...hold, demo } : hold;
}

/** A plan's holds with their pictures; demos already on `before` (by hold name) are kept. */
export function withPictures(plan: StretchPlan, before?: StretchPlan | null): StretchPlan {
  const kept = new Map((before?.holds ?? []).filter((h) => h.demo).map((h) => [h.name.trim().toLowerCase(), h.demo!]));
  return { ...plan, holds: plan.holds.map((h) => withPicture(kept.has(h.name.trim().toLowerCase()) ? { ...h, demo: kept.get(h.name.trim().toLowerCase())! } : h)) };
}
