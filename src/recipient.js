/**
 * An EarningRecord represents one year of Social Security earning data.
 * @constructor
 */
function EarningRecord() {
  this.year = -1;
  this.taxedEarnings = -1;
  this.taxedMedicareEarnings = -1;

  this.earningsCap = -1;
  this.indexFactor = -1;
  this.isTopEarningsYear = null;
}
      
/**
 * Computes the indexed earnings for this tax record.
 * @return {number}
 */
EarningRecord.prototype.indexedEarning = function() {
  var cappedEarning = Math.min(this.earningsCap, this.taxedEarnings);
  return Math.round(100 * cappedEarning * this.indexFactor) / 100;
};

/**
 * A Recipient object manages calculating a user's SSA and IRS data.
 * @constructor
 * @param {string} recipient's initial name.
 */
function Recipient(name) {
  this.initialized_ = false;
  
  /* The recipients name.
   * @type {string}
   */
  this.name = name

  /* The recipient's earning records over all years in the SSA database, if any.
   * @type {!Array<EarningRecord>}
   */
  this.earningsRecords = [];

  // In addition, we allow the recipient to specify future earnings as two
  // values: number of years and wage per year.
  this.futureEarningsYears = 0;
  this.futureEarningsWage = 0;

  // Once earnings have been processed, this stores the indexed earning dollar
  // amount below which additional earnings values will not affect earnings.
  this.cutoffIndexedEarnings = 0;
 
  // This value is the your total over the <= 35 years of earning history.
  this.totalIndexedEarnings = 0;
 
  // This value is the your average monthly earnings (floored) over the <= 35
  // years of earning history: total earnings / 35 / 12.
  this.monthlyIndexedEarnings = 0;

  // This is the monthly primary insurance amount, calculated either from
  // monthlyIndexedEarnings or set directly.
  this.primaryInsuranceAmountValue = 0;

  // This is the recipient's "lay" birthdate, which is the day they were born.
  this.layBirthDate = new Date(1980, 0, 1);

  // Recipient's birth date and normal retirement date in year and month. This
  // is the "SSA" birthdate, based on the day before the "lay" birthdate.
  this.birthDate = new MonthDate().initFromYearsMonths(1970, 0);

  // TODO(gregable): Compute this on the fly.
  this.normalRetirementDate = new MonthDate(2037, 0);

  // This is a tuple of:
  // minYear, maxYear, ageYears, ageMonths, delatedIncreaseAnnual
  this.normalRetirement = FULL_RETIREMENT_AGE[0];
  
  // If true, the user's birthday is on the first, so they can recieve full
  // benefits on the month they turn 62.
  this.isFullMonth = false;
}

/**
 * Returns true if the Recipient has been initialized from earnings records.
 * @return {boolean}
 */
Recipient.prototype.isInitialized = function() {
  return this.initialized_;
};

/**
 * Initializes our data from an array of earning records data.
 * Data should be in the form:
 * [ { 
 *     year: 1960,
 *     taxedEarnings: 19123,
 *     taxedMedicareEarnings: 19123,
 *    },
 *    ...
 * ]
 * Data should already be sorted by year ascending.
 *
 * @param {!Array<!EarningRecord>} earningsRecords
 */
Recipient.prototype.initFromEarningsRecords = function(earningsRecords) {
  this.earningsRecords = earningsRecords;
  this.processIndexedEarnings_();
  this.initialized_ = true;
};

/**
 * Allows a user to simulate working additional years in the future.
 */
Recipient.prototype.simulateFutureEarningsYears = function(numYears, wage) {
  this.futureEarningsYears = numYears;
  this.futureEarningsWage = wage;
  this.processIndexedEarnings_();
};


/**
 * Takes a javascript Date object of layBirthdate and converts it to an SSA
 * birthdate. The SSA birthdate is one day earlier, and we drop the day of month
 * at that point, because SSA cares only about month and year.
 * @param {layBirthDate} Date
 * @return {MonthDate}
 */
ssaBirthDate = function(layBirthdate) {
  // We subtract 12 hours. 24 or 1 could get into trouble with daylight
  // savings time changes. Why doesn't javascript have better date libraries?
  var englishBirthdate = new Date(
      layBirthdate.getTime() - (12 * 60 * 60 * 1000));

  return new MonthDate().initFromYearsMonths(
      englishBirthdate.getFullYear(), englishBirthdate.getMonth());
}

/**
 * This returns the date in the given year that it is considered a person's
 * birthday, as well as their age.
 */
Recipient.prototype.exampleAge = function(year) {
  if (year === undefined)
    year = CURRENT_YEAR;
  var example = {
    'age': year - this.birthDate.year(),
    'month': this.birthDate.monthFullName(),
    'year': year
  };
  example['day'] = new Date(
      this.layBirthDate - (12 * 60 * 60 * 1000)).getDate();
  return example;
}

/*
 * Update this recipient's birthdate. Caller should provide the lay birthdate
 * as a JavaScript Date object.
 * @param {Date} birthdate
 */
Recipient.prototype.updateBirthdate = function(birthdate) {
  this.layBirthDate = birthdate;
  this.birthDate = ssaBirthDate(birthdate);
  this.isFullMonth = birthdate.getDate() === 1;

  // Find the retirement age bracket data for this recipient.
  for (var i = 0; i < FULL_RETIREMENT_AGE.length; ++i) {
    var ageBracket = FULL_RETIREMENT_AGE[i];
    if (this.birthDate.year() >= ageBracket.minYear &&
        this.birthDate.year() <= ageBracket.maxYear) {
      this.normalRetirement = ageBracket;
    }
  }
  var normalRetirementAge = this.normalRetirementAge();
  this.normalRetirementDate = this.birthDate.addDuration(normalRetirementAge);

  // Birthdate can affect indexed earnings.
  this.processIndexedEarnings_();
}

/**
 * Returns the date at a given age.
 * @param {MonthDuration} age
 * @return {MonthDate}
 */
Recipient.prototype.dateAtAge = function(age) {
  console.assert(typeof age === typeof new MonthDate(), age);
  return this.birthDate.addDuration(age);
};

/**
 * Convenience method for dateAtAge that accepts an integer years old.
 * Used primarily in partials.
 * @param {number} year
 * @return {MonthDate}
 */
Recipient.prototype.dateAtYearsOld = function(years) {
  return this.dateAtAge(new MonthDuration().initFromYearsMonths(years, 0));
};

/**
 * Returns the age at a given date.
 * @param {MonthDate} date
 * @return {MonthDuration}
 */
Recipient.prototype.ageAtDate = function(date) {
  return date.subtractDate(this.birthDate);
};

// Used for displaying text for earners whose indexing factors are still
// changing.
Recipient.prototype.isOver60 = function() {
  var age = this.ageAtDate(
      new MonthDate().initFromYearsMonths(CURRENT_YEAR, 0));
  return age.years > 60;
}

// From https://www.ssa.gov/oact/cola/piaformula.html, the PIA calculation
// depends on the year at which an individual first becomes eligible for
// benefits, (when they turn 62). The computation is based on the wage
// index from two years prior. If the user is not yet 62, we use the
// most up to date bend points, which are for the current year.
Recipient.prototype.indexingYear = function() {  
  return Math.min(this.dateAtYearsOld(62).year(), CURRENT_YEAR) - 2;
}

/**
 * For each earnings record, match up the year with the MAXIMUM_EARNINGS
 * and WAGE_INDICES data, compute indexed earnings for that record, adding it
 * to the record. This is the main loop for calculating primary insurance amount
 * from earnings data.
 * @private
 */
Recipient.prototype.processIndexedEarnings_ = function() {
  // If there are no earning records, the result will be 0. Don't recompute.
  // Note this case also occurs for recipients who have had their PIA set
  // directly, rather than via earnings records.
  if (this.monthlyIndexedEarnings === 0 &&
      this.earningsRecords.length === 0)
    return;

  var allIndexedValues = [];
  for (var i = 0; i < this.earningsRecords.length; ++i) {
    var earningRecord = this.earningsRecords[i];

    earningRecord.earningsCap = MAXIMUM_EARNINGS[earningRecord.year];

    // https://www.ssa.gov/oact/ProgData/retirebenefit1.html
    // Starting in the year the user turns 60, their index factor
    // is always 1.0, regardless of the index factor from the table.
    if ((earningRecord.year - this.birthDate.year()) >= 60) {
      earningRecord.indexFactor = 1.0;
    // Otherwise the index factor for a prior year Y is the result of
    // dividing the average wage index for the year in which the person
    // attains age 60 by the average age index for year Y.
    } else if (WAGE_INDICES[earningRecord.year] === undefined) {
        earningRecord.indexFactor = 1.0;
    } else {
      earningRecord.indexFactor = (WAGE_INDICES[this.indexingYear()] /
          WAGE_INDICES[earningRecord.year]);
    }
    
    if (earningRecord.taxedEarnings !== -1)
      allIndexedValues.push(earningRecord.indexedEarning());
  }
  if (this.futureEarningsWage > 0) {
    for (var i = 0; i < this.futureEarningsYears; ++i) {
      allIndexedValues.push(this.futureEarningsWage);
    }
  }

  // Reverse sort the indexed values. Yay javascript, sorting numbers
  // alphabetically!
  allIndexedValues.sort(function(a, b) {return a-b});
  allIndexedValues.reverse();

  // Your top N values are the only ones that 'count'. Compute the cutoff
  // value below which earnings don't count.
  // TODO: Right now if there is a tie for the cutoff, we show all tied
  // elements as a Top N value, leading to a situation where we could show
  // more than N top-N values.
  if (allIndexedValues.length < SSA_EARNINGS_YEARS) {
    this.cutoffIndexedEarnings = 0;
  } else {
    this.cutoffIndexedEarnings = allIndexedValues[SSA_EARNINGS_YEARS - 1];
  }

  // Set bits for all years above the top earning year.
  for (var i = 0; i < this.earningsRecords.length; ++i) {
    var earningRecord = this.earningsRecords[i];
    if (earningRecord.indexedEarning() >= this.cutoffIndexedEarnings &&
        earningRecord.taxedEarnings > 0) {
      earningRecord.isTopEarningYear = true;
    } else {
      earningRecord.isTopEarningYear = false;
    }
  }

  // Total indexed earnings is the sum of your top 35 indexed earnings.
  this.totalIndexedEarnings = 0;
  for (var i = 0; i < allIndexedValues.length && i < SSA_EARNINGS_YEARS; ++i) {
    this.totalIndexedEarnings += allIndexedValues[i];
  }

  // SSA floors the monthly indexed earnings value. This floored value
  // is the basis for all following calculations. So, if you want to consider
  // your anual insurance amount, it's computed based on monthly values, ie:
  // 12 * floor(totalIndexedEarnings / 12)
  this.monthlyIndexedEarnings =
    Math.floor(this.totalIndexedEarnings / 12 / SSA_EARNINGS_YEARS);
  
  // From the monthlyIndexedEarnings, compute this user's primary insurance
  // amount.
  this.primaryInsuranceAmountValue =
    colaAdjustment(this.dateAtYearsOld(62).year(),
        this.primaryInsuranceAmountUnadjusted());
};


/**
 * Returns the number of years for which we have earnings records.
 * @return {number}
 */
Recipient.prototype.numEarningsYears = function() {
  var nonNegativeRecords = 0;
  for (var i = 0; i < this.earningsRecords.length; ++i) {
    if (this.earningsRecords[i].taxedEarnings >= 0)
      nonNegativeRecords += 1;
  }
  
  if (this.futureEarningsWage > 0)
    return nonNegativeRecords + this.futureEarningsYears;
  else
    return nonNegativeRecords;

};

/**
 * Returns the PIA component a specific breakpoint bracket for this
 * user's monthly indexed earnings.
 * @param {number} bracket Must be 0, 1, or 2
 * @return {number} benefit in that bracket.
 */
Recipient.prototype.primaryInsuranceAmountByBracket = function(bracket) {
  return primaryInsuranceAmountForEarningsByBracket(
      this.indexingYear(), this.monthlyIndexedEarnings, bracket);
};

/**
 * Returns the primary insurance amount (monthly benefit) summed across all
 * benefit brackets, but not adjusted for COLA increases.
 * @return {number} unadjusted primary insurance amount
 */
Recipient.prototype.primaryInsuranceAmountUnadjusted = function() {
  return primaryInsuranceAmountForEarningsUnadjusted(
      this.indexingYear(), this.monthlyIndexedEarnings);
}

/**
 * Returns true iff the user's age is such that their PIA needs to be
 * adjusted for COLA values. This boolean is used to show/hide a section.
 * @return {boolean}
 */
Recipient.prototype.shouldAdjustForCOLA = function() {
  return this.dateAtYearsOld(62).year() <= CURRENT_YEAR;
};

/**
 * Returns an array of adjustments to be displayed to the user. Each record
 * has the year, the adjustment rate, and the starting/ending values.
 * @return {Array<Object>}
 */
Recipient.prototype.colaAdjustments = function() {
  const years = colaAdjustmentYears(this.dateAtYearsOld(62).year());
  var adjusted = this.primaryInsuranceAmountUnadjusted();

  if (this.adjustments_ !== undefined) {
    if (this.adjustments_.length === 0 && years.length === 0)
     return this.adjustments_;
    if (this.adjustments_.length > 0 && this.adjustments_[0].start === adjusted)
     return this.adjustments_;
  }

  this.adjustments_ = [];
  for (var year of years) {
    if (COLA[year] !== undefined) {
      var newadjusted = adjusted * (1 + (COLA[year] / 100.0));
      // Primary Insurance amounts are always rounded down the the nearest dime.
      newadjusted = Math.floor(newadjusted * 10) / 10;

      this.adjustments_.push(
          {
            'year': year,
            'cola': COLA[year],
            'start': adjusted,
            'end': newadjusted,
          });

      adjusted = newadjusted;
    }
  }
  return this.adjustments_;
}

/**
 * Returns the primary insurance amount (monthly benefit) summed across all
 * benefit brackets and adjusted for COLA increases (if any).
 * @return {number} primary insurance amount
 */
Recipient.prototype.primaryInsuranceAmount = function() {
  // Handle user input in the spousal case. Angular enforces that the input is
  // a number-formatted string, but not that it's a number.
  parsed = parseFloat(this.primaryInsuranceAmountValue);
  if (isNaN(parsed))
    return 0;
  // Primary Insurance amounts are always rounded down the the nearest dime.
  // Who decided this was an important step?
  return Math.floor(parsed * 10) / 10;  
};

/**
 * Returns the primary insurance amount floored. This is the actual payment
 * amount if paid out.
 * @return {number} floored primary insurance amount
 */
Recipient.prototype.primaryInsuranceAmountFloored = function() {
  return Math.floor(this.primaryInsuranceAmount());
};

/**
 * Returns the annual rate of benefit increase for taking late benefits.
 * @return {number}
 */
Recipient.prototype.delayIncreaseRate = function() {
  return this.normalRetirement.delayedIncreaseAnnual;
}

/**
 * Returns the normal retirement age given the current birthdate.
 * @return {MonthDuration}
 */
Recipient.prototype.normalRetirementAge = function() {
  return new MonthDuration().initFromYearsMonths(
      this.normalRetirement.ageYears,
      this.normalRetirement.ageMonths);
}

/**
 * Returns benefit multiplier at a given age.
 * @param {MonthDuration} age
 * @return {number}
 */
Recipient.prototype.benefitMultiplierAtAge = function(age) {
  const nra = this.normalRetirementAge();
  // Compute the number of total months between birth and full retirement age.
  if (nra.greaterThan(age)) {
    // Reduced benefits due to taking benefits early.
    var before = nra.subtract(age);
    return -1.0 * ((Math.min(36, before.asMonths()) * 5.0 / 900.0) +
                   (Math.max(0, before.asMonths() - 36) * 5.0 / 1200.0));
  } else {
    // Increased benefits due to taking benefits late.
    const after = age.subtract(nra);
    return this.delayIncreaseRate() / 12 * after.asMonths();
  }
};

/**
 * Returns personal benefit amount if starting benefits at a given age.
 * @param {MonthDuration} age
 * @return {number}
 */
Recipient.prototype.benefitAtAge = function(age) {
  return Math.floor(
      this.primaryInsuranceAmountFloored() *
      (1 + this.benefitMultiplierAtAge(age)));
};

/**
 * @param {Recipient} spouse
 */
Recipient.prototype.setSpouse = function(spouse) {
  this.spouse = spouse;
};

/**
 * Returns spousal benefit multiplier at a given age.
 * @param {MonthDuration} age
 * @return {number}
 */
Recipient.prototype.spousalBenefitMultiplierAtAge = function(age) {
  // Compute the number of total months between birth and full retirement age.
  const nra = this.normalRetirementAge();
  if (nra.greaterThan(age)) {
    // Reduced benefits due to taking benefits early.
    var before = nra.subtract(age);
    return -1.0 * ((Math.min(36, before.asMonths()) * 25.0 / 3600.0) +
                   (Math.max(0, before.asMonths() - 36) * 5.0 / 1200.0));
  } else {
    // No increased benefits from taking spousal benefits later than full
    // retirement age.
    return 0.0;
  }
};

/**
 * Returns the final total benefit amount (personal + spousal) based on both
 * the recipient's start age and recipient's age when spousal benefits start.
 * Age is specified as a year and month index (0-11) since birth.
 * @param {MonthDuration} startAge
 */
Recipient.prototype.totalBenefitWithSpousal = function(startAge,
                                                       spousalStartAge) {
  const personalBenefit = this.benefitAtAge(startAge);

  // The spousal benefit at full retirement is half the spouse's PIA minus
  // the spouses PIA, or 0.
  const maxBenefitWithSpousal = this.spouse.primaryInsuranceAmount() / 2.0;
  const spousalBenefitAtFRA = 
      Math.max(0, maxBenefitWithSpousal - this.primaryInsuranceAmount());

  const spousalBenefitMultiplier = this.spousalBenefitMultiplierAtAge(
      spousalStartAge);
  const spousalBenefit = spousalBenefitAtFRA * (1 + spousalBenefitMultiplier);


  // You can't go above spousalBenefitAtFRA with a spousal benefit. If your
  // personal benefit is already higher than spousalBenefitAtFRA, you get your
  // personal benefit. If your combined benefit is greater than the
  // spousalBenefitAtFRA you cap out at spousalBenefitAtFRA. If not, you get
  // the sum.
  if (personalBenefit > maxBenefitWithSpousal) {
    return Math.floor(personalBenefit);
  } else if ((personalBenefit + spousalBenefit) > maxBenefitWithSpousal) {
    return Math.floor(maxBenefitWithSpousal)
  } else {
    return Math.floor(personalBenefit + spousalBenefit);
  }
}

/**
 * For delayed retirement credits only, you only collect your credits for the
 * first year you were recieving benefits for the entire year, with the
 * exception of when you turn 70. This method computes the personal benefits at
 * a given date, given also what date you filed. Does not compute spousal
 * effects.
 * @param {MonthDate} atDate date of the received benefits.
 * @param {MonthDate} filingDate date that this recipient filed.
 */
Recipient.prototype.benefitAtDateGivenFiling = function(atDate, filingDate) {
  // If recipient hasn't filed yet, no benefit:
  if (filingDate.greaterThan(atDate))
    return 0;
  // 70 is an explicit exception because the SSA likes to make my life harder.
  if (this.ageAtDate(filingDate).years() >= 70)
    return this.benefitAtAge(this.ageAtDate(filingDate));
  // If you are filing before normal retirement, no delayed credits anyway.
  if (filingDate.lessThanOrEqual(this.normalRetirementDate))
    return this.benefitAtAge(this.ageAtDate(filingDate));
  // If you file in January, you are receiving benefits for the entire year.
  if (filingDate.monthIndex() === 0)
    return this.benefitAtAge(this.ageAtDate(filingDate));
  // If this is the year after filing, you are receiving benefits for this
  // entire year.
  if (filingDate.year() < atDate.year())
    return this.benefitAtAge(this.ageAtDate(filingDate));
  // Otherwise, you only get credits up to January of this year,
  // or NRA, whichever is later.
  var thisJan =
      new MonthDate().initFromYearsMonths(filingDate.year(), 0);
  var benefitComputationDate = 
    this.normalRetirementDate.greaterThan(thisJan) ?
        this.normalRetirementDate : thisJan;
  return this.benefitAtAge(this.ageAtDate(benefitComputationDate));
}

/**
 * Computes the total benefit amount for this recipient at the date `atDate`
 * given their spouse's data, and each recipient's filing date.
 * @param {MonthDate} atDate date of the received benefits.
 * @param {MonthDate} filingDate date that this recipient filed.
 * @param {MonthDate} spouseFilingDAte date that the spouse filed.
 */
Recipient.prototype.totalBenefitAtDate = function(
    atDate, filingDate, spouseFilingDate) {
  // Each recipient should file between 62 and 70 inclusive. If their PIA is 0,
  // they should file sometime after 62, since they may just file at the date
  // the spouse files.
  console.assert(
      this.ageAtDate(filingDate).greaterThan(new MonthDuration(61, 11)));
  if (this.primaryInsuranceAmountFloored() > 0)
    console.assert(this.ageAtDate(filingDate)
        .lessThan(new MonthDuration().initFromYearsMonths(70, 1)));
  console.assert(this.spouse.ageAtDate(spouseFilingDate)
      .greaterThan(new MonthDuration(61, 11)));
  if (this.spouse.primaryInsuranceAmountFloored() > 0)
    console.assert(this.spouse.ageAtDate(spouseFilingDate).lessThan(
          new MonthDuration().initFromYearsMonths(70, 1)));

  // If recipient hasn't filed yet, no benefit:
  if (filingDate.greaterThan(atDate))
    return 0;

  // Simple case, no spousal effects. My earnings are greater than spouse's.
  if (this.primaryInsuranceAmount() >= this.spouse.primaryInsuranceAmount()) {
    return this.benefitAtDateGivenFiling(atDate, filingDate);
  }
 
  if (spouseFilingDate.greaterThan(atDate)) {
    // Only this recipient has filed, no spousal effects.
    return this.benefitAtDateGivenFiling(atDate, filingDate);
  }

  // Both earners have filed. Spousal benefits begin at the later of the two
  // filing dates
  var spousalDate = filingDate.greaterThan(spouseFilingDate) ?
    filingDate : spouseFilingDate;
  
  // This is complicated. If the total is just half of the spouse's PIA
  // or no delayed retirement credits are involved, then the total is correct.
  const maxBenefitWithSpousal = Math.floor(
      this.spouse.primaryInsuranceAmount() / 2.0);
  var total = this.totalBenefitWithSpousal(this.ageAtDate(filingDate),
                                           this.ageAtDate(spousalDate));
  if (total == maxBenefitWithSpousal ||
      filingDate.lessThanOrEqual(this.normalRetirementDate))
    return total;
  // Otherwise, this is a user with delayed retirement credits in play, so we
  // may need to reduce the benefit for the first year.
  var justPersonal = this.benefitAtDateGivenFiling(atDate, filingDate);
  if (justPersonal > maxBenefitWithSpousal)
    return justPersonal;
  // But this should drop them back below the spousal rate.
  return maxBenefitWithSpousal;
}

