function fixDigits(value) {


  return String(value)

    .toLowerCase()

    /*
     * 数字としてよく間違える文字
     */

    .replace(/o/g, '0')

    .replace(/[il|]/g, '1')

    .replace(/s/g, '5')

    .replace(/b/g, '8')

    .replace(/z/g, '2');

}



/*
 * =============================================
 * 品番抽出
 * =============================================
 */

function extractItemCode(text) {

  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();


  /*
   * ==========================================
   * OCR結果を行ごとに整理
   * ==========================================
   */

  const lines = lower
    .split(/\n/)
    .map(line =>
      line
        .replace(/[^a-z0-9]/g, '')
    )
    .filter(Boolean);


  /*
   * ==========================================
   * ① m系
   *
   * m20261012
   * m077
   *
   * OCR例：
   *
   * Agm20261012
   * KRm0077
   *
   * でも拾う
   * ==========================================
   */

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];


    /*
     * 行の途中でも
     * m + 8桁を探す
     */

    const firstMatch =
      line.match(
        /m([0-9oilsbz|]{8})/
      );


    if (!firstMatch) {
      continue;
    }


    /*
     * 日付部分を数字補正
     */

    const date =
      fixDigits(
        firstMatch[1]
      );


    if (!/^\d{8}$/.test(date)) {
      continue;
    }


    /*
     * 次の数行から
     * m + 番号を探す
     */

    for (
      let j = i + 1;
      j <= i + 4 &&
      j < lines.length;
      j++
    ) {

      const secondLine =
        lines[j];


      /*
       * 行の途中にあってもOK
       *
       * KRm0077
       * ↓
       * m0077
       */

      const secondMatch =
        secondLine.match(
          /m([0-9oilsbz|]{3,6})/
        );


      if (!secondMatch) {
        continue;
      }


      const number =
        fixDigits(
          secondMatch[1]
        )
        .replace(/\D/g, '');


      if (
        number.length >= 3
      ) {

        /*
         * m0077
         * ↓
         * 0077
         * ↓
         * 077
         */

        return (
          'm' +
          date +
          'm' +
          number.slice(-3)
        );

      }

    }

  }



  /*
   * ==========================================
   * ② k系
   *
   * k20260238
   * k017
   *
   * ↓
   *
   * k20260238k017
   * ==========================================
   */

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];


    const firstMatch =
      line.match(
        /k([0-9oilsbz|]{8})/
      );


    if (!firstMatch) {
      continue;
    }


    const date =
      fixDigits(
        firstMatch[1]
      );


    if (!/^\d{8}$/.test(date)) {
      continue;
    }


    for (
      let j = i + 1;
      j <= i + 4 &&
      j < lines.length;
      j++
    ) {

      const secondLine =
        lines[j];


      const secondMatch =
        secondLine.match(
          /k([0-9oilsbz|]{3,6})/
        );


      if (!secondMatch) {
        continue;
      }


      const number =
        fixDigits(
          secondMatch[1]
        )
        .replace(/\D/g, '');


      if (
        number.length >= 3
      ) {

        return (
          'k' +
          date +
          'k' +
          number.slice(-3)
        );

      }

    }

  }



  /*
   * ==========================================
   * ③ ACS系
   *
   * 20250220
   * acs025
   * ==========================================
   */

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    /*
     * 行の中から8桁を探す
     */

    const fixedLine =
      fixDigits(
        lines[i]
      );


    const dateMatch =
      fixedLine.match(
        /\d{8}/
      );


    if (!dateMatch) {
      continue;
    }


    const date =
      dateMatch[0];


    for (
      let j = i + 1;
      j <= i + 4 &&
      j < lines.length;
      j++
    ) {

      const second =
        lines[j];


      /*
       * ACS
       */

      const acsMatch =
        second.match(
          /acs([0-9oilsbz|]{3,6})/
        );


      if (acsMatch) {

        const number =
          fixDigits(
            acsMatch[1]
          )
          .replace(/\D/g, '');


        if (
          number.length >= 3
        ) {

          return (
            date +
            'acs' +
            number.slice(-3)
          );

        }

      }

    }

  }



  /*
   * ==========================================
   * ④ a系
   *
   * 20260227
   * a016
   * ==========================================
   */

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const fixedLine =
      fixDigits(
        lines[i]
      );


    const dateMatch =
      fixedLine.match(
        /\d{8}/
      );


    if (!dateMatch) {
      continue;
    }


    const date =
      dateMatch[0];


    for (
      let j = i + 1;
      j <= i + 4 &&
      j < lines.length;
      j++
    ) {

      const second =
        lines[j];


      const aMatch =
        second.match(
          /a([0-9oilsbz|]{3,6})/
        );


      if (!aMatch) {
        continue;
      }


      const number =
        fixDigits(
          aMatch[1]
        )
        .replace(/\D/g, '');


      if (
        number.length >= 3
      ) {

        return (
          date +
          'a' +
          number.slice(-3)
        );

      }

    }

  }


  return null;

}

/*
 * =============================================
 * 品番形式確認
 * =============================================
 */

function isValidCode(code) {

  return (

    /^m\d{8}m\d{3}$/.test(code)

    ||

    /^k\d{8}k\d{3}$/.test(code)

    ||

    /^\d{8}a\d{3}$/.test(code)

    ||

    /^\d{8}acs\d{3}$/.test(code)

  );

}





export {extractItemCode, isValidCode};
