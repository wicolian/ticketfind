// Which state each PVR INOX city is in. PVR INOX sends the city's location but leaves its state empty.
// A city missing here falls under "Other" until someone adds it.
const BY_STATE: Record<string, string[]> = {
  "Andhra Pradesh": ["Guntur", "Kakinada", "Machillipatnam", "Narsipatnam", "Vijayawada", "Vizag", "Vizianagaram"],
  Assam: ["Guwahati", "Jorhat"],
  Bihar: ["Muzaffarpur", "Patna"],
  Chandigarh: ["Chandigarh"],
  Chhattisgarh: ["Bhilai", "Bilaspur", "Raipur"],
  Delhi: ["Delhi", "Delhi-NCR"],
  Goa: ["Goa"],
  Gujarat: ["Ahmedabad", "Anand", "Gandhinagar", "Jamnagar", "Nadiad", "Rajkot", "Surat", "Vadodara"],
  Haryana: ["Faridabad", "Gurugram", "Panchkula", "Panipat", "Yamunanagar"],
  "Jammu and Kashmir": ["Jammu", "Srinagar"],
  Jharkhand: ["Bokaro", "Dhanbad", "Ranchi"],
  Karnataka: ["Belagavi", "Belgaum", "Bengaluru", "Dharwad", "Gulbarga", "Hubli", "Mangalore", "Manipal", "Mysuru", "Tumakuru"],
  Kerala: ["Kochi", "Thrissur", "Trivandrum"],
  Ladakh: ["Leh"],
  "Madhya Pradesh": ["Bhopal", "Gwalior", "Indore", "Jabalpur", "Ujjain"],
  Maharashtra: ["Aurangabad", "Jalgaon", "Kalyan", "Kolhapur", "Latur", "Mumbai", "Mumbai-All", "Nagpur", "Nanded", "Nashik", "Navi Mumbai", "Pune", "Thane"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela"],
  Puducherry: ["Pondicherry"],
  Punjab: ["Amritsar", "Jalandhar", "Khanna", "Ludhiana", "Mohali", "Pathankot", "Patiala", "Zirakpur"],
  Rajasthan: ["Ajmer", "Bhilwara", "Bhiwadi", "Jaipur", "Jodhpur", "Kota", "Sri Ganganagar", "Udaipur"],
  Sikkim: ["Gangtok"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Cuddalore", "Madurai", "Salem", "Vellore"],
  Telangana: ["Armoor", "Hyderabad", "Nizamabad", "Warangal"],
  "Uttar Pradesh": ["Agra", "Bareilly", "Ghaziabad", "Gorakhpur", "Greater Noida", "Kanpur", "Lucknow", "Meerut", "Moradabad", "Noida", "Prayagraj"],
  Uttarakhand: ["Dehradun"],
  "West Bengal": ["Burdwan", "Howrah", "Kolkata", "Liluah", "Siliguri"],
};

const STATE_OF = new Map(Object.entries(BY_STATE).flatMap(([s, list]) => list.map((c) => [c.toLowerCase(), s] as const)));

export const stateOf = (city: string) => STATE_OF.get(city.toLowerCase()) ?? "Other";
