export const FISH = [
  { id: 'fish1', src: '/assets/fish1.png', thumbnail: '/assets/thumbs/fish1.png', label: 'Goldie' },
  { id: 'fish2', src: '/assets/fish2.png', thumbnail: '/assets/thumbs/fish2.png', label: 'Angel' },
  { id: 'fish3', src: '/assets/fish3.png', thumbnail: '/assets/thumbs/fish3.png', label: 'Clown' },
  { id: 'fish4', src: '/assets/fish4.png', thumbnail: '/assets/thumbs/fish4.png', label: 'Angler Fish' },
  { id: 'fish5', src: '/assets/fish5.png', thumbnail: '/assets/thumbs/fish5.png', label: 'Tropical' },
  { id: 'puffer1', src: '/assets/Puffer1.png', thumbnail: '/assets/thumbs/Puffer1.png', label: 'Puffer' },
  { id: 'seahorse1', src: '/assets/seahorse1.png', thumbnail: '/assets/thumbs/seahorse1.png', label: 'Seahorse' },
  { id: 'eel1', src: '/assets/eel1.png', thumbnail: '/assets/thumbs/eel1.png', label: 'Eel' },
  { id: 'stingray1', src: '/assets/stingray1.png', thumbnail: '/assets/thumbs/stingray1.png', label: 'Sting Ray' },
  { id: 'seaslug1', src: '/assets/seaslug1.png', thumbnail: '/assets/thumbs/seaslug1.png', label: 'Sea Slug' },
  { id: 'shark1', src: '/assets/shark1.png', thumbnail: '/assets/thumbs/shark1.png', label: 'Shark' },
  { id: 'octo1', src: '/assets/octo1.png', thumbnail: '/assets/thumbs/octo1.png', label: 'Octopus' },
  { id: 'shrimp1', src: '/assets/shrimp1.png', thumbnail: '/assets/thumbs/shrimp1.png', label: 'Shrimp' },
  { id: 'squid1', src: '/assets/squid1.png', thumbnail: '/assets/thumbs/squid1.png', label: 'Squid' },
  { id: 'seastar1', src: '/assets/seastar1.png', thumbnail: '/assets/thumbs/seastar1.png', label: 'Sea Star' },
];

export const SPECIES_LABELS = Object.fromEntries(FISH.map(({ id, label }) => [id, label]));
