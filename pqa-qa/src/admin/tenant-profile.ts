// Realistic content for the tenants the suite creates, supplied by the tester on 2026-10-12:
// the seven logos, and four Department of Commerce divisions that the ministry-portal phase
// will route questions to. Keyed by the wizard's field labels.

export const LOGOS: Record<string, string> = {
  'Ministry crest': 'https://www.ux4g.gov.in/images/logo-download/National-Emblem/logo.png',
  'App icon (collapsed sidebar)': 'https://www.ux4g.gov.in/images/logo-download/RailTel/logo.png',
  'App wordmark (expanded sidebar)': 'https://www.ux4g.gov.in/images/logo-download/@GOV/logo.png',
  'Assistant avatar': 'https://www.ux4g.gov.in/images/logo-download/iGOT/logo.png',
  'Assistant avatar (on colour)': '/botIcon-white.svg',
  'Assistant splash logo': 'https://www.ux4g.gov.in/images/logo-download/Competition-Commission-of-India-(CCI)/logo.png',
  'Assistant splash logo (on colour)': '/botLogo-white.svg',
};

export interface Division {
  name: string;
  /** Letters, digits and ( ) & / - only; unique per tenant (it derives the division's mail address). */
  short: string;
  handles: string;
}

export const DIVISIONS: Division[] = [
  {
    name: 'Foreign Trade (Coordination)',
    short: 'FT(Coord)',
    handles: [
      '1. Appellate Committee consideration of appeal under FT (D&R) Act, 1992.',
      '2. Implementation of 20 points programmes and all work relating thereto.',
      '3. Monitoring of weekly Senior Officers Meeting with Commerce Secretary.',
      '4. Coordination work including reply of Parliament Questions which do not relate to any other Section.',
      '5. Issues referred to by other Departments/Ministries except such matters which are being handled by different sections. (All matters relating to Infrastructure namely of Ministries/Departments of Power, Civil Aviation, Surface Transport, Ports, Railways, Communication, Petroleum and Natural Gas, Non-Conventional Energy and Coal would be handled by Infrastructure Section).',
      '6. References received from various Departments regarding monthly summary of activities.',
      '7. Monitoring of VIP/MP/PMO References.',
      '8. Issues referred to by other Ministries/Departments on Initiatives/Programmes not specific to any Division of DoC including new subjects/issues and requiring coordination amongst DoC organizations.',
      '9. Non-Financial Logo Support for various events/melas/exhibitions etc.',
    ].join('\n'),
  },
  {
    name: 'Export Promotion (Export Inspection)',
    short: 'EP(EI)',
    handles: [
      '1. Administrative work and other matters relating to the EIC.',
      '2. Investigation of complaints received from exporters (Foreign Countries through our High Commission/Embassies) regarding export of sub-standard material.',
      '3. All matters relating to enforcement of the Export (Quality Control and Inspection) Act, 1963, including processing of applications for the recognition of private inspection agencies / Testing Houses Surveyor / Supplier under Section 7 of the Act.',
      '4. Coordination of all work relating to introduction of Compulsory Quality for the preshipment Inspection in consultation with commodity Sections, where necessary; work relating to individual commodities will, however, be done by the Commodity Sections concerned in consultation with Export Inspection Section.',
      '5. Work relating to "Codex Alimentarius Commissions" of FAO.',
      '6. Framing of rules under Export (Quality Control and Inspection).',
      '7. Work relating to Codex Committee on Contaminants in Food (CCCF).',
    ].join('\n'),
  },
  {
    name: 'Export Products (Agriculture)',
    short: 'EP(Agri)',
    handles: [
      'EP (Agri. I & VI) Desk: All Coordination [Annual, Quarterly & Monthly Reports; Inputs to FT (Coord), EPL, O&M, B&A, Parliament Section VIP/PG/RTI etc. on various matters]; Policy matters related to export of Oilseeds, Edible Oils & Oilmeals; Matters related to IOPEPC; Residual matters related to TMA scheme; Reports/Studies/Trade Enquiries, Commercial Intelligence, Export Analysis, etc.; Parliament Questions, VIP references, Grievances, RTI applications etc. on above matters.',
      'EP (Agri. II) Desk: CACP matters; IMC/CoS/CoM on monitoring of prices of essential commodities; Policy matters related to export of essential commodities (Onion, Potato, Pulses, Cereals, Sugar & Molasses etc.) and Areca Nut; Biotechnology/GEAC; Residual matters related to CEPCI; Customs/Central Excise Duties; Parliament Questions, VIP references, Grievances, RTI applications etc. on above matters.',
      'EP (Agri. III) Desk: Tobacco Board; Policy matters related to export of Tobacco and Tobacco Products; WTO, SPS/TBT, Codex and Food Standards related issues; Policy matters related to organic products; MAI proposals relating to agriculture sector; Proposals for participation in fairs & exhibitions (APEDA and Tobacco Board); Parliament Questions, VIP references, Grievances, RTI applications etc. on above matters.',
      "EP (Agri. IV) Desk: APEDA; Matters related to APEDA's Export Promotion Scheme; Policy matters related to export of all APEDA Scheduled Products except those looked after by EP (Agri. II); Policy matters related to organic products; Parliament Questions, VIP references, Grievances, RTI applications etc. on above matters.",
    ].join('\n'),
  },
  {
    name: 'Foreign Trade (NAFTA)',
    short: 'FT(NAFTA)',
    handles: [
      "Functions: FT-NAFTA Division deals with bilateral trade and investment matters with North American countries i.e. USA, Canada and Mexico, facilitation of B2B meetings, redressal of exporters' grievances relating to Non-Tariff Barriers, Bilateral Trade Agreements, supporting and facilitating India's exporters' participation in trade promotion activities such as trade exhibitions, trade fairs, etc.",
      'List of subjects:',
      "1. All territorial matters relating to India's trade with USA, Canada and Mexico.",
      '2. Coordination with Indian Missions in USA, Canada & Mexico.',
      '3. Parliament matters concerning the countries being dealt, in the Division.',
      '4. RTI on issues pertaining to trade related issues with USA, Canada & Mexico.',
      '5. Grievances/Complaint/VIP-References.',
    ].join('\n'),
  },
];
