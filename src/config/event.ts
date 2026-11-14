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
  { label: 'Timeline', href: '#schedule' },
  { label: 'Experience', href: '#prizes' },
  { label: 'Organizers', href: '#organizers' },
  { label: 'Event Info', href: '#info' },
]

export const keyStats = [
  { value: '1,00,000', unit: 'INR', label: 'Provisional Prize Pool', desc: 'Final award details to be announced' },
  { value: '36', unit: 'HOURS', label: 'Continuous Building', desc: 'A focused, live build window' },
  { value: '700+', unit: 'BUILDERS', label: 'National Participants', desc: 'A national student community' },
  { value: '5', unit: 'TRACKS', label: 'Challenge Fields', desc: 'Core problem domains' },
]

export interface Track {
  id: string
  number: string
  title: string
  description: string
  focusAreas: string
  status?: string
}

export const tracks: Track[] = [
  {
    id: 'generative-ai-automation',
    number: '01',
    title: 'Generative AI & Automation',
    description: 'Participants build practical software tools that go beyond basic chat interfaces to automate complex, multi-step workflows.',
    focusAreas: 'Multi-agent systems, enterprise productivity, automated code review, and localized language assistants.',
    status: 'ACTIVE DOMAIN',
  },
  {
    id: 'cybersecurity-digital-forensics',
    number: '02',
    title: 'Cybersecurity & Digital Forensics',
    description: 'Participants build proactive defense tools and investigative software that protect sensitive data, detect active threats, and uncover digital footprints.',
    focusAreas: 'Threat intelligence, phishing detection, automated log analysis, privacy-preserving cryptography, and incident response workflows.',
    status: 'ACTIVE DOMAIN',
  },
  {
    id: 'fintech-blockchain',
    number: '03',
    title: 'FinTech & Blockchain',
    description: 'Participants build accessible financial applications and decentralized protocols that streamline payments, automate wealth management, and establish trustless digital ecosystems.',
    focusAreas: 'Smart contract security, decentralized identity, micro-lending platforms, cross-border payment rails, and automated personal finance tools.',
    status: 'ACTIVE DOMAIN',
  },
  {
    id: 'healthtech-mental-wellbeing',
    number: '04',
    title: 'HealthTech & Mental Well-being',
    description: 'Participants build accessible digital health platforms and supportive software tools that improve patient care, simplify medical workflows, and promote daily mental wellness.',
    focusAreas: 'Telemedicine interfaces, symptom triage systems, cognitive behavioral therapy tools, accessible UI/UX for users with disabilities, and preventative health tracking.',
    status: 'ACTIVE DOMAIN',
  },
  {
    id: 'open-innovation',
    number: '05',
    title: 'Open Innovation (Open Track)',
    description: 'Any idea that solves a real problem, in any field. No good idea gets turned away.',
    focusAreas: 'Developer tools, EdTech platforms, creator economy software, sustainable tech, and experimental web applications.',
    status: 'OPEN TRACK',
  },
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
    value: '5 Technology Domains',
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
  entries: { name: string; designation: string; department?: string; avatar?: string }[]
}

export const organizerGroups: OrganizerGroup[] = [
  {
    title: 'Convener',
    role: 'Event Leadership',
    accent: 'gold',
    entries: [
      {
        name: 'Mrs. M. Manasa',
        designation: 'HoD CSE',
        department: 'Department of Computer Science and Engineering',
      },
      {
        name: 'G. Jashanth',
        designation: 'CSE III Year',
        department: 'Department of Computer Science and Engineering',
      },
      {
        name: 'A. Sai Vaibhav',
        designation: 'CSE III Year',
        department: 'Department of Computer Science and Engineering',
      },
    ],
  },
  {
    title: 'Co-Conveners',
    role: '',
    accent: 'cyan',
    entries: [
      {
        name: 'V. Varaprasad',
        designation: 'CSE III Year',
        department: 'Department of Computer Science and Engineering',
      },
      {
        name: 'Sana Firdous',
        designation: 'CSE III Year',
        department: 'Department of Computer Science and Engineering',
      },
      {
        name: 'G. Snehal Reddy',
        designation: 'CSE III Year',
        department: 'Department of Computer Science and Engineering',
      },
    ],
  },
  {
    title: 'Faculty Co-ordinators',
    role: '',
    accent: 'violet',
    entries: [
      {
        name: 'Mrs. K. Swapna Rani',
        designation: 'Assistant Professor, CSE',
        department: 'Department of Computer Science and Engineering',
      },
      {
        name: 'Mrs. B. Upassana',
        designation: 'Assistant Professor, CSE',
        department: 'Department of Computer Science and Engineering',
      },
    ],
  },
]
