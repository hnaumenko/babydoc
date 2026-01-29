export interface SourceMetadata {
    filename: string;
    title: string;
    type: 'medical_guide' | 'textbook' | 'parenting_book';
    reliability: number; // 1-5 (5 = AAP/Medical standard)
    age_min: number; // months
    age_max: number; // months
    language: string;
  }
  
  export const SOURCE_MAP: Record<string, SourceMetadata> = {
    // 1. Библия педиатрии (AAP) - Высший приоритет
    "caring-for-your-baby-and-young-child-birth-to-age-5_compress.pdf": {
      filename: "caring-for-your-baby-and-young-child-birth-to-age-5_compress.pdf",
      title: "Caring for Your Baby and Young Child (AAP)",
      type: "medical_guide",
      reliability: 5,
      age_min: 0,
      age_max: 60,
      language: 'en',
    },
    // 2. Гайд для новорожденных (AAP) - Высший приоритет
    "Heading Home with Your Newborn  From Birth to Reality (Laura A. Jana Jennifer Shu) (Z-Library).pdf": {
      filename: "Heading Home with Your Newborn  From Birth to Reality (Laura A. Jana Jennifer Shu) (Z-Library).pdf",
      title: "Heading Home with Your Newborn",
      type: "medical_guide",
      reliability: 5,
      age_min: 0,
      age_max: 12,
      language: 'en',
    },
    // 3. Учебник по развитию - Высокий приоритет для "норм развития"
    "How Children Develop 6th Canadian Edition By Robert S. Siegler ( etc.) (Z-Library).pdf": {
      filename: "How Children Develop 6th Canadian Edition By Robert S. Siegler ( etc.) (Z-Library).pdf",
      title: "How Children Develop",
      type: "textbook",
      reliability: 4,
      age_min: 0,
      age_max: 216, // 18 years
      language: 'en', 
    },
    // 4. Психология - Средний приоритет (хорошо для поведения, плохо для медицины)
    "The Whole-Brain Child 12 Revolutionary Strategies to Nurture Your Childs Developing Mind (Daniel J. Siegel) (Z-Library).pdf": {
      filename: "The Whole-Brain Child 12 Revolutionary Strategies to Nurture Your Childs Developing Mind (Daniel J. Siegel) (Z-Library).pdf",
      title: "The Whole-Brain Child",
      type: "parenting_book",
      reliability: 3,
      age_min: 12,
      age_max: 144,
      language: 'en',
    },
    // 5. Прикорм (BLW) - Низкий приоритет (субъективный метод)
    "_OceanofPDF.com_Baby_Leads_the_Way_-_Julie_Laux.pdf": {
      filename: "_OceanofPDF.com_Baby_Leads_the_Way_-_Julie_Laux.pdf",
      title: "Baby Leads the Way",
      type: "parenting_book",
      reliability: 2,
      age_min: 6,
      age_max: 24,
      language: 'en', 
    }
  };