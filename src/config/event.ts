// Provisional clock time only; organizers must confirm before publishing as official.
const commencementTime = '10:00:00+05:30'
const startDate = `2027-02-19T${commencementTime}`
const endDate = new Date(Date.parse(startDate) + 36 * 60 * 60 * 1000).toISOString()
const formatEventDay = (date: string) => new Date(date).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
})

export const event = {
  name: "KGRCET's HACKATHON 2027",
  tagline: 'A 36-HOUR NATIONAL LEVEL HACKATHON',
  subheading: "Where India's brightest engineers, designers, and innovators build next-generation solutions in a 36-hour sprint.",
  shortName: 'KGRCET HACK 2027',
  edition: 'National Edition 2027',
  institution: 'KG Reddy College of Engineering and Technology',
  institutionShort: 'KGRCET',
  organizer: 'Cybersecurity & Ethical Hacking Club',
  organizerShort: 'CSEH Club',
  location: 'Hyderabad, Telangana, India',
  venue: 'KG Reddy College of Engineering & Technology, Beside Moinabad Police Station, Chilkur Village, Moinabad Mandal, Ranga Reddy District, Hyderabad, Telangana - 501504',
  duration: '36 Hours',
  durationSubtitle: 'Non-Stop Collaborative Build',
  theme: 'Autonomous AI, Cybersecurity & Breakthrough Systems',
  startDate,
  endDate,
  startTimeConfirmed: false,
  registrationDeadline: 'To be announced',
  dateDisplay: 'FEBRUARY 19-20, 2027',
  registrationUrl: '/register',
  registrationStatus: 'Team drafts open; official submissions are not yet open',
  participantTarget: '300+ Elite Builders',
  teamSizeLimit: 'To be announced by the organizers',
  prizePool: 'INR 1,00,000',
  prizePoolStatus: 'Provisional prize pool',
  contactEmail: 'cseh@kgrcet.edu.in',
} as const

export const navigation = [
  { label: 'Overview', href: '#about' },
  { label: 'Tracks', href: '#tracks' },
  { label: 'Experience', href: '#prizes' },
  { label: 'Timeline', href: '#schedule' },
  { label: 'Event Info', href: '#info' },
  { label: 'Organizers', href: '#organizers' },
]

export const keyStats = [
  { value: '1,00,000', unit: 'INR', label: 'Provisional Prize Pool', desc: 'Final award details to be announced' },
  { value: '36', unit: 'HOURS', label: 'Continuous Building', desc: 'A focused, live build window' },
  { value: '300+', unit: 'BUILDERS', label: 'National Participants', desc: 'A national student community' },
  { value: '10', unit: 'TRACKS', label: 'Challenge Fields', desc: 'Provisional problem domains' },
]

export interface Track {
  id: string
  number: string
  title: string
  status: 'PROVISIONAL TRACK'
}

export const tracks: Track[] = [
  { id: 'generative-ai-llm', number: '01', title: 'Generative AI & LLM Applications', status: 'PROVISIONAL TRACK' },
  { id: 'cybersecurity-defense', number: '02', title: 'Cybersecurity & Cyber Defense', status: 'PROVISIONAL TRACK' },
  { id: 'healthcare-wellness', number: '03', title: 'Healthcare & Digital Wellness', status: 'PROVISIONAL TRACK' },
  { id: 'fintech-payments', number: '04', title: 'FinTech & Digital Payments', status: 'PROVISIONAL TRACK' },
  { id: 'smart-cities', number: '05', title: 'Smart Cities & Urban Innovation', status: 'PROVISIONAL TRACK' },
  { id: 'education-learning', number: '06', title: 'Education & Learning Technology', status: 'PROVISIONAL TRACK' },
  { id: 'sustainability-climate', number: '07', title: 'Sustainability & Climate Technology', status: 'PROVISIONAL TRACK' },
  { id: 'agriculture-rural', number: '08', title: 'Agriculture & Rural Innovation', status: 'PROVISIONAL TRACK' },
  { id: 'developer-tools', number: '09', title: 'Developer Tools & Productivity', status: 'PROVISIONAL TRACK' },
  { id: 'open-innovation', number: '10', title: 'Open Innovation', status: 'PROVISIONAL TRACK' },
]

export const prizes = [
  {
    tier: 'PRIZE POOL',
    amount: 'INR 1,00,000',
    rank: 'PROVISIONAL VALUE',
    badge: 'AWARDS',
    highlight: true,
    perks: [
      'The provisional pool for KGRCET’s Hackathon 2027.',
      'Final categories and distribution will be announced by the organizers.',
    ],
  },
  {
    tier: 'TRACK RECOGNITION',
    amount: 'Pending',
    rank: 'DETAILS PENDING',
    badge: 'TRACKS',
    highlight: false,
    perks: [
      'Recognition criteria for the challenge tracks will be shared before the event.',
      'Follow official event communication for confirmed award information.',
    ],
  },
  {
    tier: 'EVENT UPDATES',
    amount: 'Pending',
    rank: 'OFFICIAL ANNOUNCEMENT',
    badge: 'UPDATES',
    highlight: false,
    perks: [
      'Prize information will be published through official KGRCET Hackathon channels.',
      'No prize distribution is confirmed until that announcement.',
    ],
  },
]

export const perksList = [
  { title: 'Meals & Energy Lounge', description: 'Food and refreshment information will be shared with selected teams.', icon: 'coffee' },
  { title: 'Connectivity', description: 'Venue connectivity arrangements will be confirmed in participant communication.', icon: 'wifi' },
  { title: 'Builder Kit', description: 'Event materials and participant kit details will be announced by the organizers.', icon: 'package' },
  { title: 'Mentorship', description: 'Mentor interaction details will be shared as the programme is finalized.', icon: 'users' },
  { title: 'Recognition', description: 'Participation and recognition details will be communicated officially.', icon: 'award' },
  { title: 'Community Space', description: 'Experience and venue arrangements will be announced closer to the event.', icon: 'gamepad' },
]

export interface TimelineMilestone {
  id: string
  date: string
  title: string
  accent: 'coral' | 'violet'
  description?: string
  details?: string[]
}

export const timelineMilestones: TimelineMilestone[] = [
  {
    id: 'registration-closes',
    date: event.registrationDeadline,
    title: 'Registration Closes',
    accent: 'coral',
    description: 'The final date to register your team.',
  },
  {
    id: 'grand-start',
    date: formatEventDay(event.startDate),
    title: 'The Grand Start',
    accent: 'violet',
    description: 'Reporting, registration verification, challenge release, and the beginning of the 36-hour hackathon.',
  },
  {
    id: 'grand-finale',
    date: formatEventDay(event.endDate),
    title: 'Grand Finale',
    accent: 'violet',
    description: 'Final submissions, judging, and prize distribution.',
  },
]

export interface EventInfoItem {
  title: string
  value: string
  detail: string
  icon: string
}

export const eventInfoDetails: EventInfoItem[] = [
  {
    title: 'Event Duration',
    value: '36 Continuous Hours',
    detail: 'Non-stop collaborative build marathon from Day 1 kick-off through Day 2 final submission.',
    icon: 'clock',
  },
  {
    title: 'Event Dates',
    value: event.dateDisplay,
    detail: 'Two dedicated sprint days with on-campus facilities, mentorship checkpoints, and live evaluations.',
    icon: 'calendar',
  },
  {
    title: 'Location & Venue',
    value: 'KGRCET Campus, Hyderabad',
    detail: 'KG Reddy College of Engineering & Technology, Chilkur Village Road, Moinabad, Hyderabad.',
    icon: 'map-pin',
  },
  {
    title: 'Team Composition',
    value: event.teamSizeLimit,
    detail: 'Eligibility and mandatory documents will be confirmed by the organizers.',
    icon: 'users',
  },
  {
    title: 'Challenge Tracks',
    value: '10 Technology Domains',
    detail: 'Specific challenge problem statements will be released during the event.',
    icon: 'terminal',
  },
  {
    title: 'Event Close',
    value: formatEventDay(event.endDate),
    detail: 'Final submissions, judging, and prize distribution conclude the 36-hour programme.',
    icon: 'award',
  },
]

export type OrganizerGroup = {
  title: string
  role: string
  accent: 'gold' | 'violet' | 'cyan'
  entries: { name: string; designation: string; department?: string }[]
}

export const organizerGroups: OrganizerGroup[] = [
  {
    title: 'Convener',
    role: 'Event Leadership',
    accent: 'gold',
    entries: [],
  },
  {
    title: 'Co-Conveners',
    role: 'Event Leadership',
    accent: 'cyan',
    entries: [],
  },
  {
    title: 'Faculty Coordinators',
    role: 'Academic Support',
    accent: 'violet',
    entries: [],
  },
]
